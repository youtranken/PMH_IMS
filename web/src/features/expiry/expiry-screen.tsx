import { useCallback, useMemo, useState } from 'react';
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
import { Pagination } from '@/ui/pagination';
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
import { useClampPage, useListUrlState } from '@/ui/use-list-url-state';
import { useFormErrors } from '@/ui/use-form-errors';
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
  /** MỘT TRANG kể từ 21/09 (N-01) — không còn là trọn bộ cửa sổ. */
  items: ExpiryRow[];
  /** Tổng số mục khớp bộ lọc — CẢ KHO, để `Pagination` biết có bao nhiêu trang. */
  total: number;
  summary: { expired: number; critical: number; warning: number };
  /*
   * `expiry.service.ts:129` trả KÈM ngưỡng đã dùng để đếm `summary`. Trước 18/09 khai báo này
   * bỏ sót nó, nên trường ấy bị vứt đi và màn phải hỏi lại `/expiry/thresholds` — một truy vấn
   * THỨ HAI, có `retry: false`, và khi nó hỏng thì lùi về 7/30 cứng.
   *
   * Hậu quả: ô số đếm bằng ngưỡng của server, bảng lọc bằng ngưỡng của truy vấn kia. Admin đặt
   * `expiry.critical_days = 14` rồi `/expiry/thresholds` lỗi một lượt → ô "Gấp" ghi 6, bấm vào
   * bảng còn 3 dòng, ba dòng kia lặng lẽ chạy sang nhóm "Sắp tới". Hai con số mâu thuẫn trên
   * cùng một màn hình, và không bài kiểm nào bắt được vì mỗi bên tự nhất quán với chính nó.
   */
  thresholds: { criticalDays: number; warningDays: number };
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
  const [renewing, setRenewing] = useState<ExpiryRow | null>(null);
  const [tab, setTab] = useState('list');

  /*
   * BA BỘ LỌC SỐNG TRÊN THANH ĐỊA CHỈ, KHÔNG TRONG `useState` (18/09/2026).
   *
   * `docs/SHARED-REGISTRY.md` viết thẳng về `useListUrlState`: "Cấm quay lại `useState` cho
   * bốn thứ đó — mất bộ lọc khi F5, không gửi được link, và bấm Back từ trang chi tiết rơi về
   * một danh sách trắng". Màn này vẫn `useState` cả ba, và ô số `state` thì MỚI SINH RA trong
   * chính nhánh này — tức luật vừa viết đã có ngoại lệ ngay lập tức.
   *
   * Lý do kỹ thuật "màn này không phân trang" không còn đứng được:
   * `features/vault/vault-home-screen.tsx` đã chứng minh hook dùng được cho màn không phân
   * trang — khai `emptyFilters`, bỏ `defaultLimit`/`defaultSort`, xong.
   *
   * `withinDays` để dạng chuỗi trong URL rồi mới `Number()`: hook giữ mọi bộ lọc là chuỗi, và
   * một link ai đó sửa tay (`?withinDays=abc`) phải rơi về mặc định chứ không thành `NaN` đi
   * thẳng vào `queryKey`.
   */
  const url = useListUrlState<{ withinDays: string; kinds: string; state: string }>({
    emptyFilters: { withinDays: '', kinds: '', state: '' },
  });
  const withinDays = WINDOWS.includes(Number(url.filters.withinDays))
    ? Number(url.filters.withinDays)
    : 30;
  const kind = url.filters.kinds;
  /** Ô số nào đang được bấm để lọc. Rỗng = xem tất cả. Lọc ở SERVER — xem chú thích dưới. */
  const state = (['expired', 'critical', 'warning'] as const).includes(
    url.filters.state as 'expired',
  )
    ? (url.filters.state as 'expired' | 'critical' | 'warning')
    : '';
  const setWithinDays = (value: number) => url.setFilter('withinDays', String(value));
  const setKind = (value: string) => url.setFilter('kinds', value);
  const setState = (value: '' | 'expired' | 'critical' | 'warning') =>
    url.setFilter('state', value);

  /*
   * `useExpiryThresholds()` chỉ còn là NGUỒN DỰ PHÒNG của màn này (sửa 19/09/2026).
   *
   * Mọi thứ trên màn — phép lọc bảng, nhãn ô số, VÀ huy hiệu ở cột Trạng thái — nay đọc `nguong`
   * bên dưới, tức ngưỡng đi KÈM chính lượt trả về, vì đó mới đúng là bộ ngưỡng mà `summary` đã
   * dùng để đếm. Bản 18/09 chỉ chuyển phép lọc và nhãn, để huy hiệu tự hỏi hook — nên màn có hai
   * nguồn: hook giữ cache 10 phút, admin đổi `expiry.critical_days` thành 14 là bảng lọc theo 14
   * còn huy hiệu tô theo 7. Lượt rà soát 19/09 tìm ra; bản vá dời lỗi chứ chưa diệt lỗi.
   */
  const thresholds = useExpiryThresholds();

  /* Nguồn nhãn loại hạn dùng chung với bảng điều khiển — xem `lib/expiry-kinds.ts` (AD-15). */
  const kinds = useExpiryKinds();

  /*
   * PHÂN TRANG VÀ LỌC NHÓM Ở MÁY CHỦ (N-01, vá 21/09).
   *
   * Tới 20/09 màn này kéo TRỌN cửa sổ về rồi lọc/sắp/bày tại chỗ — 7.662 dòng ở 30k hồ sơ, và
   * ở 200k thì không dùng được. Nó còn làm bẩn cả phiên: mở `/expiry` một lần thì màn kế tiếp
   * cũng chậm theo (9.730ms so với 582ms khi đo một mình), vì trình duyệt còn đang dọn 841k node.
   *
   * `state` đi CÙNG lên server, không lọc ở client nữa. Giữ lại ở client thì bấm "Gấp" chỉ lọc
   * trong 50 dòng đang xem trong khi nút ngay trên đầu đề số 87 — một màn tự mâu thuẫn, và nó
   * sinh ra do chính bản vá này chứ không phải lỗi cũ.
   */
  const expiry = useQuery({
    queryKey: ['expiry', withinDays, kind, state, url.page, url.limit],
    queryFn: () =>
      apiFetch<ExpiryResponse>(
        `/api/v1/expiry?withinDays=${withinDays}&page=${url.page}&limit=${url.limit}` +
          `${kind ? `&kinds=${kind}` : ''}${state ? `&state=${state}` : ''}`,
      ),
  });
  useClampPage(url, expiry.data?.total);

  /*
   * `useCallback` chứ không phải hàm trần: nó nằm trong deps của `columns` bên dưới, và một
   * hàm mới mỗi render sẽ làm memo tính lại mỗi render — tức vô hiệu hoá chính cái memo.
   */
  const kindLabel = useCallback(
    (value: string) => kinds.data?.find((item) => item.kind === value)?.label ?? value,
    [kinds.data],
  );

  const summary = expiry.data?.summary;

  /*
   * Ba nhóm KHÔNG phủ kín bảng, và đó là đúng: dòng còn xa hơn ngưỡng "sắp tới" không thuộc
   * nhóm nào (server đếm y như vậy — xem `levelOf()` trong `expiry.service.ts`). Ba ô cộng lại
   * không bằng số dòng; chúng đếm "cần chú ý", không đếm "có bao nhiêu dòng".
   *
   * Ngưỡng ĐI KÈM lượt trả về, không phải từ `useExpiryThresholds()` — chỉ bộ này mới chắc chắn
   * là bộ mà `summary` đã dùng để đếm. Chưa về thì lùi về hook (nó có bản dự phòng riêng).
   *
   * Phép LỌC theo nhóm đã chuyển xuống server 21/09 (N-01); ở đây `nguong` chỉ còn để TÔ MÀU.
   */
  const nguong = expiry.data?.thresholds ?? thresholds;
  const rows = expiry.data?.items ?? [];

  const columns = useMemo<ColumnDef<ExpiryRow, unknown>[]>(
    () => [
      {
        accessorKey: 'label',
        // Sắp ở client chỉ đảo chỗ trang đang xem — xem chú thích ở <DataTable>.
        enableSorting: false,
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
        // Sắp ở client chỉ đảo chỗ trang đang xem — xem chú thích ở <DataTable>.
        enableSorting: false,
        header: t('expiry.kind'),
        cell: ({ row }) => kindLabel(row.original.kind),
      },
      {
        accessorKey: 'end',
        // Sắp ở client chỉ đảo chỗ trang đang xem — xem chú thích ở <DataTable>.
        enableSorting: false,
        header: t('expiry.end'),
        cell: ({ row }) => orDash(formatDate(row.original.end)),
      },
      {
        // Sắp theo "còn bao nhiêu ngày" chứ không theo chữ trên badge: xếp theo chữ thì
        // "Quá hạn 40 ngày" và "Quá hạn 2 ngày" đứng cạnh nhau vô nghĩa.
        accessorKey: 'daysLeft',
        // Sắp ở client chỉ đảo chỗ trang đang xem — xem chú thích ở <DataTable>.
        enableSorting: false,
        header: t('expiry.state'),
        // AD-15: luật "sắp hết hạn" chỉ có một, ở lib/expiry.ts
        /* Truyền `nguong` — cùng bộ ngưỡng mà phép lọc và nhãn ô số dùng. Không truyền là màn
           này có hai nguồn: bảng lọc theo ngưỡng của lượt trả về, huy hiệu tô theo cache 10
           phút của hook. Xem chú thích prop `thresholds` ở `ui/expiry-badge.tsx`. */
        cell: ({ row }) => <ExpiryBadge end={row.original.end} thresholds={nguong} />,
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
    /*
     * `nguong` PHẢI có mặt ở đây (sửa 20/09/2026, lỗi F-01).
     *
     * Thiếu nó thì `cell` của cột Tình trạng đóng băng bộ ngưỡng của lượt render ĐẦU —
     * lúc `expiry.data` còn `undefined` nên `nguong` là `DEFAULT_EXPIRY_THRESHOLDS` (7/30).
     * Dữ liệu về mang ngưỡng thật (ví dụ 14/30), `rows` ở dòng trên lọc theo 14, còn huy hiệu
     * vẫn tô theo 7: ô "Gấp" ghi 6, bấm vào ra 6 dòng, chỉ 2 dòng đỏ. Đúng cảnh mà khối chú
     * thích ở `ui/expiry-badge.tsx:38-40` sinh ra để dẹp.
     *
     * Không bài kiểm nào bắt được vì 7/30 cũng là seed của migration 0041 — mọi lượt chạy
     * dev/E2E đều ở đúng cấu hình che lỗi.
     */
    [t, kindLabel, nguong],
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
            label={t('expiry.critical', { days: nguong.criticalDays })}
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
          /*
           * KHÔNG `initialSort` nữa, và các cột KHÔNG cho bấm sắp (N-01, vá 21/09).
           *
           * Chú thích cũ ở đây nói sắp-ở-client là đúng "vì màn này không phân trang". Câu ấy
           * ngừng đúng ngay khi phân trang: sắp client chỉ đảo chỗ 50 dòng đang xem, nên bấm
           * cột "Hồ sơ" cho ra một thứ tự chỉ đúng trong trang — đúng lớp lỗi mà chính câu chú
           * thích ấy cảnh báo.
           *
           * Server đã sắp theo ngày hết hạn tăng dần, tức GẤP NHẤT LÊN ĐẦU — đó là lý do màn
           * này tồn tại, nên giữ nguyên thứ tự ấy là câu trả lời đúng chứ không phải một hạn
           * chế. Muốn sắp theo cột khác thì phải có `?sort=` ở server; ghi vào mục 8.9.
           */
          rowClassName={(row) => (row.daysLeft < 0 ? 'row-danger' : '')}
        />
      )}

      <Pagination
        page={url.page}
        limit={url.limit}
        onLimitChange={url.setLimit}
        total={expiry.data?.total ?? 0}
        onPageChange={url.setPage}
      />

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
  const check = useFormErrors({ endDate: !endDate && t('expiry.pickDate') });
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
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          renew.mutate(
            { kind: row.kind, id: row.id, endDate },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">
          {kindLabel} · {t('expiry.end')}: {formatDate(row.end)}
        </p>
        <Field
          label={t('expiry.newEnd')}
          required
          hint={t('expiry.renewHint')}
          error={check.error('endDate')}
        >
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
