import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDate, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { DataTable } from '@/ui/data-table';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
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

interface ExpiryKind {
  kind: string;
  label: string;
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

  const kinds = useQuery({
    queryKey: ['expiry', 'kinds'],
    queryFn: () => apiFetch<ExpiryKind[]>('/api/v1/expiry/kinds'),
  });

  const expiry = useQuery({
    queryKey: ['expiry', withinDays, kind],
    queryFn: () =>
      apiFetch<ExpiryResponse>(
        `/api/v1/expiry?withinDays=${withinDays}${kind ? `&kinds=${kind}` : ''}`,
      ),
  });

  const kindLabel = (value: string) =>
    kinds.data?.find((item) => item.kind === value)?.label ?? value;

  const rows = expiry.data?.items ?? [];
  const summary = expiry.data?.summary;

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
            <button
              type="button"
              className="btn sm primary"
              onClick={() => setRenewing(row.original)}
            >
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

      {/* Ba con số này là thứ người ta nhìn đầu tiên mỗi sáng. */}
      {summary ? (
        <div className="device-summary">
          <span className={`badge ${summary.expired > 0 ? 'danger' : 'muted'}`}>
            {t('expiry.expired')}: {summary.expired}
          </span>
          <span className={`badge ${summary.critical > 0 ? 'danger' : 'muted'}`}>
            {t('expiry.critical')}: {summary.critical}
          </span>
          <span className={`badge ${summary.warning > 0 ? 'warn' : 'muted'}`}>
            {t('expiry.warning')}: {summary.warning}
          </span>
        </div>
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
            <LoadError onRetry={() => void kinds.refetch()} />
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
        <LoadError onRetry={() => void expiry.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('expiry.empty')} hint={t('expiry.emptyHint')} />
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
