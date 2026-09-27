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
import { RowActions } from '@/ui/row-actions';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { useClampPage, useListUrlState } from '@/ui/use-list-url-state';
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

const DEFAULT_LIMIT = 20;

/* `[key: string]: string` để khớp ràng buộc của `useListUrlState` — hook đọc/ghi bộ lọc theo
   TÊN KHÓA lên URL nên nó phải duyệt được các khóa. `kind`/`status` vẫn giữ union hẹp cho
   chỗ dùng. */
interface Filters extends Record<string, string> {
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
  /*
   * Bộ lọc · trang · số dòng · cột sắp nằm trên THANH ĐỊA CHỈ, không trong `useState` nữa
   * (17/09/2026). Nhờ vậy: F5 giữ nguyên bộ lọc, gửi được link "tài khoản VPN đã đóng" cho
   * đồng nghiệp, và bấm Back từ trang chi tiết về ĐÚNG kết quả cũ thay vì một danh sách
   * trắng. Ô tìm cũng có debounce 250ms — trước đây mỗi phím là một lượt gọi API.
   */
  const url = useListUrlState<Filters>({
    emptyFilters: EMPTY_FILTERS,
    defaultLimit: DEFAULT_LIMIT,
    defaultSort: { key: 'code', desc: false },
    searchKey: 'search',
  });
  const { page, limit } = url;
  const filters = url.filters;
  // Sắp xếp chạy ở SERVER (`manualSorting`), nên dựng lại `SortingState` cho `DataTable`.
  const sorting: SortingState = [{ id: url.sorting.key, desc: url.sorting.desc }];
  const setPage = url.setPage;
  const setLimit = url.setLimit;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ServiceAccountRow | null>(null);
  /** Hồ sơ đang chờ đổi trạng thái, kèm chiều đổi — cùng một hộp cho cả đóng lẫn mở lại. */
  const [switching, setSwitching] = useState<{
    row: ServiceAccountRow;
    next: ServiceAccountStatus;
  } | null>(null);

  /** Ghi chỉ SA/Admin — API chặn, UI đừng bày nút ra để bấm rồi 403. */
  const canEdit = me.role === 'sa' || me.role === 'admin';

  const accounts = useQuery({
    queryKey: ['service-accounts', page, limit, filters, sorting],
    queryFn: () =>
      apiFetch<{ items: ServiceAccountRow[]; total: number }>(
        `/api/v1/service-accounts?${buildQuery(page, limit, filters, sorting)}`,
      ),
  });
  useClampPage(url, accounts.data?.total);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['service-accounts'] });

  // Mọi bộ lọc đều đưa về trang 1 (hook tự xoá `page`): giữ nguyên trang 5 khi đổi lọc thì
  // bảng trông như rỗng.
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    url.setFilter(key, value as string);
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
              meta: { className: 'col-center' },
              cell: ({ row }) => (
                <div className="action-cell">
                  <RowActions
                    label={t('common.actionsOf', { subject: row.original.code })}
                    items={[
                      {
                        key: 'edit',
                        label: t('common.edit'),
                        onSelect: () => setEditing(row.original),
                      },
                      /* Đổi trạng thái là đường RIÊNG vì nó BẮT ghi lý do — không phải một giá
                         trị trong ô Trạng thái của form. Xem chú thích ở `service-account-form`.
                         Hai chiều đối xứng: đóng rồi thì phải có đường mở lại, cũng kèm lý do,
                         không thì hồ sơ đã đóng là đóng vĩnh viễn với người dùng giao diện. */
                      row.original.status === 'active'
                        ? {
                            key: 'disable',
                            label: t('serviceAccounts.disable'),
                            onSelect: () =>
                              setSwitching({ row: row.original, next: 'disabled' }),
                            danger: true,
                          }
                        : {
                            key: 'enable',
                            label: t('serviceAccounts.enable'),
                            onSelect: () =>
                              setSwitching({ row: row.original, next: 'active' }),
                          },
                    ]}
                  />
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
        search={url.searchInput}
        onSearchChange={url.setSearchInput}
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
        <LoadError error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          /* HAI cảnh, HAI câu: "chưa khai gì" mời người dùng thêm bản ghi đầu tiên, "lọc không
             ra" mời họ nới bộ lọc. Một câu cho cả hai thì hệ thống vừa cài xong báo "không khớp
             bộ lọc" và người dùng đi tìm cái bộ lọc không tồn tại. */
          title={url.isFiltered ? t('serviceAccounts.emptyFiltered') : t('serviceAccounts.empty')}
          hint={url.isFiltered ? t('serviceAccounts.emptyFilteredHint') : t('serviceAccounts.emptyHint')}
        />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            emptyText={url.isFiltered ? t('serviceAccounts.emptyFiltered') : t('serviceAccounts.empty')}
            stackOnMobile
            manualSorting
            sorting={sorting}
            onSortingChange={(updater) => {
              const next = typeof updater === 'function' ? updater(sorting) : updater;
              const first = next[0];
              // Đổi cột sắp xếp thì hook tự bỏ `page` khỏi URL: giữ nguyên trang 5 của thứ tự
              // CŨ là nhìn vào một lát cắt chẳng liên quan gì tới thứ tự vừa chọn.
              url.setSorting(
                first ? { key: String(first.id), desc: !!first.desc } : { key: 'code', desc: false },
              );
            }}
          />
          <Pagination
            page={page}
            limit={limit}
            onLimitChange={setLimit}
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

      {switching ? (
        <StatusDialog
          row={switching.row}
          next={switching.next}
          csrfToken={me.csrfToken}
          onClose={() => setSwitching(null)}
          onDone={() => {
            const done = switching.next === 'disabled' ? 'disabled' : 'enabled';
            setSwitching(null);
            toast({ message: t(`serviceAccounts.${done}`) });
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
 * Đổi trạng thái kèm LÝ DO — đường duy nhất đóng, và cũng là đường duy nhất mở lại.
 *
 * Cùng khuôn với hộp gỡ rule NAT: "tài khoản này đóng ngày nào, ai đóng, vì sao" là câu sáu
 * tháng sau sẽ có người hỏi, và chỉ dòng lịch sử trả lời được. Mở lại cũng vậy: bật lại một
 * tài khoản dùng chung đã bị đóng là một quyết định, không phải một lần sửa ô.
 *
 * MỘT hộp cho hai chiều, không hai bản copy: khác nhau đúng ba thứ — endpoint, nhãn, tông nút.
 */
function StatusDialog({
  row,
  next,
  csrfToken,
  onClose,
  onDone,
}: {
  row: ServiceAccountRow;
  /** Trạng thái SẼ tới, không phải trạng thái đang có. */
  next: ServiceAccountStatus;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const off = next === 'disabled';
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const change = useApiMutation<{ reason: string }, unknown>(
    `/api/v1/service-accounts/${row.id}/${off ? 'disable' : 'enable'}`,
    { method: 'PATCH', csrfToken, refreshMe: false },
  );
  const label = off ? t('serviceAccounts.disable') : t('serviceAccounts.enable');

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ.
         `guardUnsaved`: chưa bấm Lưu mà lỡ Esc thì hỏi lại, đừng xoá trắng. */
      dismissible={!change.isPending}
      guardUnsaved
      maxWidth={480}
      title={`${label} — ${row.code}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="sa-status-form"
            className={off ? 'btn danger' : 'btn primary'}
            disabled={change.isPending}
          >
            {change.isPending ? t('common.loading') : label}
          </button>
        </>
      }
    >
      <form
        id="sa-status-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          change.mutate(
            { reason: reason.trim() },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">
          {off ? t('serviceAccounts.disableHint') : t('serviceAccounts.enableHint')}
        </p>
        <Field
          label={off ? t('serviceAccounts.disableReason') : t('serviceAccounts.enableReason')}
          required
          htmlFor="sa-status-reason"
        >
          <input
            id="sa-status-reason"
            className="inp"
            required
            minLength={3}
            placeholder={
              off
                ? t('serviceAccounts.disableReasonPlaceholder')
                : t('serviceAccounts.enableReasonPlaceholder')
            }
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

function buildQuery(page: number, limit: number, filters: Filters, sorting: SortingState): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.status) params.set('status', filters.status);
  return [params.toString(), sortQuery(sorting)].filter(Boolean).join('&');
}
