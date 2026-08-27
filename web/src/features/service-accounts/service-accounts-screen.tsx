import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { sortQuery } from '@/lib/sort-query';
import { DataTable } from '@/ui/data-table';
import { Dialog } from '@/ui/dialog';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { ServiceAccountForm } from './service-account-form';
import {
  KIND_KEY,
  SERVICE_ACCOUNT_KINDS,
  SERVICE_ACCOUNT_STATUSES,
  STATUS_KEY,
  STATUS_TONE,
  type ServiceAccountKind,
  type ServiceAccountRow,
  type ServiceAccountStatus,
} from './service-account-types';

const LIMIT = 20;

interface Filters {
  search: string;
  kind: '' | ServiceAccountKind;
  status: '' | ServiceAccountStatus;
}

const EMPTY_FILTERS: Filters = { search: '', kind: '', status: '' };

/**
 * Tài khoản dịch vụ (0032): tài khoản DÙNG CHUNG và tài khoản VPN.
 *
 * Vì sao có màn này: két sắt chỉ gắn được vào thiết bị hoặc hồ sơ phần mềm, nên mật khẩu email
 * dùng chung của Kế toán, tài khoản cổng VNPT, tài khoản ngân hàng… không có chỗ nào để đứng.
 * Chúng không phải một cái máy, cũng không phải một license.
 */
export function ServiceAccountsScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'code', desc: false }]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ServiceAccountRow | null>(null);
  const [disabling, setDisabling] = useState<ServiceAccountRow | null>(null);

  /** Ghi chỉ SA/Admin — API chặn, UI đừng bày nút ra để bấm rồi 403. */
  const canEdit = me.role === 'sa' || me.role === 'admin';

  const accounts = useQuery({
    queryKey: ['service-accounts', page, filters, sorting],
    queryFn: () =>
      apiFetch<{ items: ServiceAccountRow[]; total: number }>(
        `/api/v1/service-accounts?${buildQuery(page, filters, sorting)}`,
      ),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['service-accounts'] });

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const rows = accounts.data?.items ?? [];

  const columns = useMemo<ColumnDef<ServiceAccountRow, unknown>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('serviceAccounts.code'),
        cell: ({ row }) => (
          <>
            <Link className="mono" to={PATHS.serviceAccount(row.original.id)}>
              {row.original.code}
            </Link>
            <span className="cell-sub">{row.original.name}</span>
          </>
        ),
      },
      {
        accessorKey: 'kind',
        header: t('serviceAccounts.kind'),
        cell: ({ row }) => (
          <span className="badge plain">{t(KIND_KEY[row.original.kind])}</span>
        ),
      },
      {
        id: 'login',
        header: t('serviceAccounts.login'),
        cell: ({ row }) => <span className="mono">{orDash(row.original.login)}</span>,
      },
      {
        id: 'owner',
        header: t('serviceAccounts.owner'),
        cell: ({ row }) => (
          <>
            {orDash(row.original.department)}
            {row.original.ownerName ? (
              <span className="cell-sub">{row.original.ownerName}</span>
            ) : null}
          </>
        ),
      },
      {
        accessorKey: 'status',
        header: t('serviceAccounts.status'),
        cell: ({ row }) => (
          <span className={`badge ${STATUS_TONE[row.original.status]}`}>
            {t(STATUS_KEY[row.original.status])}
          </span>
        ),
      },
      ...(canEdit
        ? [
            {
              id: 'actions',
              header: t('common.actions'),
              cell: ({ row }) => (
                <div className="action-cell">
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={t('serviceAccounts.editOf', { code: row.original.code })}
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditing(row.original);
                    }}
                  >
                    {t('common.edit')}
                  </button>
                  {/* Vô hiệu hóa là đường RIÊNG vì nó BẮT ghi lý do — không phải một giá trị
                      trong ô Trạng thái của form. Xem chú thích ở `service-account-form`. */}
                  {row.original.status === 'active' ? (
                    <button
                      type="button"
                      className="btn sm danger"
                      aria-label={t('serviceAccounts.disableOf', { code: row.original.code })}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDisabling(row.original);
                      }}
                    >
                      {t('serviceAccounts.disable')}
                    </button>
                  ) : null}
                </div>
              ),
            } as ColumnDef<ServiceAccountRow, unknown>,
          ]
        : []),
    ],
    [t, canEdit],
  );

  return (
    <>
      <PageHeader
        title={t('serviceAccounts.title')}
        subtitle={t('serviceAccounts.subtitle')}
        actions={
          canEdit ? (
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>
              {t('serviceAccounts.add')}
            </button>
          ) : null
        }
      />

      <FilterBar
        search={filters.search}
        onSearchChange={(value) => setFilter('search', value)}
        searchPlaceholder={t('serviceAccounts.search')}
      >
        <Select
          value={filters.kind}
          ariaLabel={t('serviceAccounts.kind')}
          placeholder={t('serviceAccounts.allKinds')}
          options={[
            { value: '', label: t('serviceAccounts.allKinds') },
            ...SERVICE_ACCOUNT_KINDS.map((kind) => ({ value: kind, label: t(KIND_KEY[kind]) })),
          ]}
          onChange={(value) => setFilter('kind', value as Filters['kind'])}
        />
        <Select
          value={filters.status}
          ariaLabel={t('serviceAccounts.status')}
          placeholder={t('serviceAccounts.allStatuses')}
          options={[
            { value: '', label: t('serviceAccounts.allStatuses') },
            ...SERVICE_ACCOUNT_STATUSES.map((status) => ({
              value: status,
              label: t(STATUS_KEY[status]),
            })),
          ]}
          onChange={(value) => setFilter('status', value as Filters['status'])}
        />
      </FilterBar>

      {accounts.isLoading ? (
        <Loading />
      ) : accounts.isError ? (
        <LoadError onRetry={() => void accounts.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('serviceAccounts.empty')} hint={t('serviceAccounts.emptyHint')} />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            emptyText={t('serviceAccounts.empty')}
            stackOnMobile
            manualSorting
            sorting={sorting}
            onSortingChange={(updater) => {
              setSorting((current) =>
                typeof updater === 'function' ? updater(current) : updater,
              );
              setPage(1);
            }}
          />
          <Pagination
            page={page}
            limit={LIMIT}
            total={accounts.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

      {creating ? (
        <ServiceAccountForm
          row={null}
          csrfToken={me.csrfToken}
          onClose={() => setCreating(false)}
          onSaved={(warnings) => {
            setCreating(false);
            for (const warning of warnings) toast({ message: warning, tone: 'warn' });
            void refresh();
          }}
        />
      ) : null}

      {disabling ? (
        <DisableDialog
          row={disabling}
          csrfToken={me.csrfToken}
          onClose={() => setDisabling(null)}
          onDone={() => {
            setDisabling(null);
            toast({ message: t('serviceAccounts.disabled') });
            void refresh();
          }}
        />
      ) : null}

      {editing ? (
        <ServiceAccountForm
          row={editing}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onSaved={(warnings) => {
            setEditing(null);
            for (const warning of warnings) toast({ message: warning, tone: 'warn' });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Vô hiệu hóa kèm LÝ DO — đường duy nhất đóng một tài khoản dịch vụ.
 *
 * Cùng khuôn với hộp gỡ rule NAT: "tài khoản này đóng ngày nào, ai đóng, vì sao" là câu sáu
 * tháng sau sẽ có người hỏi, và chỉ dòng lịch sử trả lời được.
 */
function DisableDialog({
  row,
  csrfToken,
  onClose,
  onDone,
}: {
  row: ServiceAccountRow;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const disable = useApiMutation<{ reason: string }, unknown>(
    `/api/v1/service-accounts/${row.id}/disable`,
    { method: 'PATCH', csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={480}
      title={`${t('serviceAccounts.disable')} — ${row.code}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="sa-disable-form"
            className="btn danger"
            disabled={disable.isPending}
          >
            {disable.isPending ? t('common.loading') : t('serviceAccounts.disable')}
          </button>
        </>
      }
    >
      <form
        id="sa-disable-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          disable.mutate(
            { reason: reason.trim() },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">{t('serviceAccounts.disableHint')}</p>
        <Field label={t('serviceAccounts.disableReason')} required htmlFor="sa-disable-reason">
          <input
            id="sa-disable-reason"
            className="inp"
            required
            minLength={3}
            placeholder={t('serviceAccounts.disableReasonPlaceholder')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
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

function buildQuery(page: number, filters: Filters, sorting: SortingState): string {
  const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.status) params.set('status', filters.status);
  return [params.toString(), sortQuery(sorting)].filter(Boolean).join('&');
}
