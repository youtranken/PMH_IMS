import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { useExpiryKinds } from '@/lib/expiry-kinds';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDate, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { DataTable } from '@/ui/data-table';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { KpiStrip, KpiTile } from '@/ui/kpi-strip';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { useExpiryThresholds } from '@/ui/use-expiry-thresholds';
import { Select } from '@/ui/select';
import { TabPanel, Tabs } from '@/ui/tabs';
import { useToast } from '@/ui/toast';
import { DigestRulesPanel } from './digest-rules-panel';

interface ExpiryRow {
  id: string;
  label: string;
  sublabel: string | null;
  kind: string;
  start: string | null;
  end: string;
  link: string;
  daysLeft: number;
  canRenew: boolean;
}


interface ExpiryResponse {
  items: ExpiryRow[];
  summary: { expired: number; critical: number; warning: number };
}

/** Cửa sổ nhìn tới — mấy mốc người ta thật sự dùng, không cho gõ số tùy ý cho rối. */
const WINDOWS = [7, 30, 60, 90, 180, 365];

/**
 * Màn Expiry tổng hợp (story 3.4, FR-012).
 *
 * Mọi thứ có ngày hết hạn của cả hệ thống về một chỗ: bảo hành thiết bị, license, SSL,
 * tên miền, hợp đồng bảo trì, hợp đồng đường truyền. Danh sách LOẠI lấy từ API — module
 * nào đăng ký nguồn thì tự xuất hiện, màn này không viết cứng tên loại nào (AD-7).
 */
export function ExpiryScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [withinDays, setWithinDays] = useState(30);
  const [kind, setKind] = useState('');
  const [renewing, setRenewing] = useState<ExpiryRow | null>(null);
  const [tab, setTab] = useState('list');
  /** Ô số nào đang được bấm để lọc. Rỗng = xem tất cả. Lọc ở CLIENT — xem chú thích dưới. */
  const [state, setState] = useState<'' | 'expired' | 'critical' | 'warning'>('');

  /*
   * Cùng NGUỒN ngưỡng với chip đếm của server và với `ExpiryBadge` (AD-15, `use-expiry-thresholds`).
   * Tự chế lại hai con số 7/30 ở đây là cách chắc chắn nhất để ô "Gấp (≤7 ngày)" ghi 2 mà lọc
   * ra 3 dòng — và không bài kiểm nào bắt được vì mỗi bên tự nhất quán với chính nó.
   */
  const thresholds = useExpiryThresholds();

  /* Nguồn nhãn loại hạn dùng chung với bảng điều khiển — xem `lib/expiry-kinds.ts` (AD-15). */
  const kinds = useExpiryKinds();

  const expiry = useQuery({
    queryKey: ['expiry', withinDays, kind],
    queryFn: () =>
      apiFetch<ExpiryResponse>(
        `/api/v1/expiry?withinDays=${withinDays}${kind ? `&kinds=${kind}` : ''}`,
      ),
  });

  const kindLabel = (value: string) =>
    kinds.data?.find((item) => item.kind === value)?.label ?? value;

  const allRows = expiry.data?.items ?? [];
  const summary = expiry.data?.summary;

  /*
   * LỌC Ở CLIENT, có chủ ý. Màn này KHÔNG phân trang — API lọc theo `withinDays` rồi trả về hết
   * — nên lọc ở đây là lọc đúng toàn bộ tập kết quả, không phải chỉ trang đang xem. Đổi lại
   * không tốn thêm một lượt gọi mạng nào, bấm là bảng đổi ngay.
   *
   * Ba nhóm KHÔNG phủ kín bảng, và đó là đúng: dòng còn xa hơn ngưỡng "sắp tới" không thuộc
   * nhóm nào (server cũng đếm y như vậy — xem `summarize()` trong `expiry.service.ts`). Ba ô
   * cộng lại không bằng số dòng; chúng đếm "cần chú ý", không đếm "có bao nhiêu dòng".
   */
  const rows = allRows.filter((row) => {
    if (state === '') return true;
    if (row.daysLeft < 0) return state === 'expired';
    if (row.daysLeft <= thresholds.criticalDays) return state === 'critical';
    if (row.daysLeft <= thresholds.warningDays) return state === 'warning';
    return false;
  });

  const columns = useMemo<ColumnDef<ExpiryRow, unknown>[]>(
    () => [
      {
        accessorKey: 'label',
        header: t('expiry.item'),
        cell: ({ row }) => (
          <>
            <Link to={row.original.link}>{row.original.label}</Link>
            {row.original.sublabel ? (
              <span className="cell-sub">{row.original.sublabel}</span>
            ) : null}
          </>
        ),
      },
      {
        accessorKey: 'kind',
        header: t('expiry.kind'),
        cell: ({ row }) => kindLabel(row.original.kind),
      },
      {
        accessorKey: 'end',
        header: t('expiry.end'),
        cell: ({ row }) => orDash(formatDate(row.original.end)),
      },
      {
        // Sắp theo "còn bao nhiêu ngày" chứ không theo chữ trên badge: xếp theo chữ thì
        // "Quá hạn 40 ngày" và "Quá hạn 2 ngày" đứng cạnh nhau vô nghĩa.
        accessorKey: 'daysLeft',
        header: t('expiry.state'),
        // AD-15: luật "sắp hết hạn" chỉ có một, ở lib/expiry.ts
        cell: ({ row }) => <ExpiryBadge end={row.original.end} />,
      },
      {
        id: 'actions',
        header: t('common.actions'),
        meta: { className: 'col-center' },
        cell: ({ row }) =>
          row.original.canRenew ? (
            /*
             * Nút THƯỜNG, không phải nút chính (hạ cấp 17/09/2026).
             *
             * Bảng này hay dài ba chục dòng, và trước đây MỖI dòng mang một nút nền gradient
             * thương hiệu. Ba chục nút cùng hét lên thì không nút nào còn to tiếng: mắt mất
             * luôn chỗ bấu víu, và cái thật sự quan trọng trên màn — dòng nào ĐỎ vì đã quá
             * hạn — bị chính hàng nút xanh át đi. Màu chính để dành cho việc chính của trang.
             */
            <button type="button" className="btn sm" onClick={() => setRenewing(row.original)}>
              {t('expiry.renew')}
            </button>
          ) : (
            // Bảo hành thiết bị không "gia hạn" được — nói rõ thay vì để nút chết.
            <span className="muted">{t('expiry.notRenewable')}</span>
          ),
      },
    ],
    [t, kinds.data],
  );

  return (
    <>
      <PageHeader
        title={t('expiry.title')}
        subtitle={t('expiry.subtitle')}
        actions={
          /* Xuất ĐÚNG cửa sổ ngày và loại đang xem — không phải cả bảng (FR-028). */
          <ExportXlsxButton
            url={`/api/v1/expiry/export.xlsx?withinDays=${withinDays}${kind ? `&kinds=${kind}` : ''}`}
            fileName="sap-het-han.xlsx"
          />
        }
      />

      {/*
        BA CON SỐ NÀY LÀ THỨ NGƯỜI TA NHÌN ĐẦU TIÊN MỖI SÁNG — nên chúng phải ĐỌC ĐƯỢC và
        BẤM ĐƯỢC (dựng lại 17/09/2026).
        Trước đây là ba cái pill 11px nằm sát nhau ("Đã quá hạn: 4  Gấp (≤7 ngày): 2  Sắp tới:
        11"): muốn biết có bao nhiêu thứ quá hạn thì phải dí mắt vào đọc, và biết rồi cũng
        không làm gì được với nó — vẫn phải tự dò trong bảng 30 dòng xem cái nào quá hạn.
        Giờ bấm một ô là bảng thu về đúng nhóm ấy; bấm lại là bỏ lọc.
      */}
      {summary ? (
        <KpiStrip>
          <KpiTile
            value={summary.expired}
            label={t('expiry.expired')}
            tone="danger"
            active={state === 'expired'}
            onClick={() => setState(state === 'expired' ? '' : 'expired')}
          />
          <KpiTile
            value={summary.critical}
            label={t('expiry.critical')}
            tone="danger"
            active={state === 'critical'}
            onClick={() => setState(state === 'critical' ? '' : 'critical')}
          />
          <KpiTile
            value={summary.warning}
            label={t('expiry.warning')}
            tone="warn"
            active={state === 'warning'}
            onClick={() => setState(state === 'warning' ? '' : 'warning')}
          />
        </KpiStrip>
      ) : null}

      <Tabs
        items={[
          { key: 'list', label: t('expiry.tabList') },
          { key: 'rules', label: t('digest.tab') },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t('expiry.title')}
      />

      {tab === 'rules' ? (
        <TabPanel tabKey="rules">
          {/*
            DANH SÁCH LOẠI HỎNG THÌ KHÔNG ĐƯỢC MỞ TRÌNH SOẠN LUẬT.
            `kinds.data ?? []` khiến hộp thoại "Thêm luật" hiện ra KHÔNG MỘT ô tick nào, y hệt
            lúc hệ thống thật sự chưa đăng ký loại nào. Người dùng lưu được một luật digest
            theo dõi RỖNG — nó không bao giờ gửi email, và không có gì trên màn nói vì sao.
          */}
          {kinds.isError ? (
            <LoadError error={kinds.error} onRetry={() => void kinds.refetch()} />
          ) : (
            <DigestRulesPanel me={me} kinds={kinds.data ?? []} />
          )}
        </TabPanel>
      ) : (
        <TabPanel tabKey="list">
      <FilterBar>
        <Select
          value={String(withinDays)}
          ariaLabel={t('expiry.window')}
          options={WINDOWS.map((days) => ({
            value: String(days),
            label: t('expiry.windowDays', { days }),
          }))}
          onChange={(value) => setWithinDays(Number(value))}
        />
        <Select
          value={kind}
          ariaLabel={t('expiry.kind')}
          placeholder={t('expiry.allKinds')}
          options={[
            { value: '', label: t('expiry.allKinds') },
            ...(kinds.data ?? []).map((item) => ({ value: item.kind, label: item.label })),
          ]}
          onChange={setKind}
        />
      </FilterBar>

      {expiry.isLoading ? (
        <Loading />
      ) : expiry.isError ? (
        <LoadError error={expiry.error} onRetry={() => void expiry.refetch()} />
      ) : rows.length === 0 ? (
        /* Rỗng vì ĐANG LỌC thì phải nói đúng lý do đó. Câu "nới cửa sổ ra 90 ngày" là lời
           khuyên sai khi thứ chặn lại là cái ô số vừa bấm — người dùng nới cửa sổ, vẫn rỗng,
           và không hiểu vì sao. */
        <EmptyState
          title={state ? t('expiry.emptyFiltered') : t('expiry.empty')}
          hint={state ? t('expiry.emptyFilteredHint') : t('expiry.emptyHint')}
        />
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          emptyText={t('expiry.empty')}
          stackOnMobile
          // Màn này KHÔNG phân trang (API lọc theo `withinDays` rồi trả hết), nên sắp ở client
          // là sắp đúng toàn bộ tập kết quả — khác các màn danh sách phân trang, ở đó sắp
          // client chỉ đảo chỗ trang đang xem nên phải nhờ server.
          initialSort={[{ id: 'end', desc: false }]}
          rowClassName={(row) => (row.daysLeft < 0 ? 'row-danger' : '')}
        />
      )}

        </TabPanel>
      )}

      {renewing ? (
        <RenewDialog
          row={renewing}
          kindLabel={kindLabel(renewing.kind)}
          csrfToken={me.csrfToken}
          onClose={() => setRenewing(null)}
          onDone={() => {
            setRenewing(null);
            toast({ message: t('expiry.renewed') });
            void queryClient.invalidateQueries({ queryKey: ['expiry'] });
          }}
        />
      ) : null}
    </>
  );
}

function RenewDialog({
  row,
  kindLabel,
  csrfToken,
  onClose,
  onDone,
}: {
  row: ExpiryRow;
  kindLabel: string;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const renew = useApiMutation<Record<string, unknown>, unknown>('/api/v1/expiry/renew', {
    csrfToken,
    refreshMe: false,
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ.
         `guardUnsaved`: chưa bấm Lưu mà lỡ Esc thì hỏi lại, đừng xoá trắng. */
      dismissible={!renew.isPending}
      guardUnsaved
      maxWidth={520}
      title={`${t('expiry.renew')} — ${row.label}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="renew-form" className="btn primary" disabled={renew.isPending}>
            {renew.isPending ? t('common.loading') : t('expiry.renew')}
          </button>
        </>
      }
    >
      <form
        id="renew-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!endDate) {
            setError(t('expiry.pickDate'));
            return;
          }
          renew.mutate(
            { kind: row.kind, id: row.id, endDate },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">
          {kindLabel} · {t('expiry.end')}: {formatDate(row.end)}
        </p>
        <Field label={t('expiry.newEnd')} required hint={t('expiry.renewHint')}>
          <DatePicker
            value={endDate}
            ariaLabel={t('expiry.newEnd')}
            /* Hạn mới phải sau hạn cũ — chặn trên lịch; API vẫn kiểm lại vì chốt chặn
               thật phải nằm ở server. */
            min={row.end}
            onChange={setEndDate}
          />
        </Field>

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
