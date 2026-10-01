import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { sortQuery } from '@/lib/sort-query';
import { DataTable } from '@/ui/data-table';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { RowActions } from '@/ui/row-actions';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { SecretDue } from '@/ui/secret-due';
import { Select } from '@/ui/select';
import { ALL_STATUSES, lifecycleStatusOptions } from '@/ui/lifecycle-status-options';
import { LifecycleHiddenEmpty } from '@/ui/lifecycle-hidden-empty';
import { useToast } from '@/ui/toast';
import { useClampPage, useListUrlState } from '@/ui/use-list-url-state';
import { ServiceAccountForm } from './service-account-form';
import { ServiceAccountStatusDialog } from './service-account-status-dialog';
import {
  KIND_KEY,
  KIND_SHORT_KEY,
  KIND_TONE,
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
  /** '' = mặc định "trừ Đã ngừng dùng" (Q-20); 'all' = không lọc trạng thái. */
  status: '' | 'all' | ServiceAccountStatus;
  /** '1' = chỉ VPN mở cho mọi IP nguồn — lọc ở API vì danh sách phân trang. */
  anyIp: '' | '1';
}

const EMPTY_FILTERS: Filters = { search: '', kind: '', status: '', anyIp: '' };

/**
 * Tài khoản dịch vụ: tài khoản DÙNG CHUNG và tài khoản VPN.
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
   * Bộ lọc · trang · số dòng · cột sắp nằm trên THANH ĐỊA CHỈ, không trong `useState`. Nhờ
   * vậy: F5 giữ nguyên bộ lọc, gửi được link "tài khoản VPN đã đóng" cho đồng nghiệp, và bấm
   * Back từ trang chi tiết về ĐÚNG kết quả cũ thay vì một danh sách trắng. Ô tìm có debounce
   * 250ms để mỗi phím không thành một lượt gọi API.
   */
  const url = useListUrlState<Filters>({
    emptyFilters: EMPTY_FILTERS,
    defaultLimit: DEFAULT_LIMIT,
    defaultSort: { key: 'code', desc: false },
    searchKey: 'search',
  });
  const { page, limit } = url;
  const filters = url.filters;
  const statusOptions = lifecycleStatusOptions(t, {
    statuses: SERVICE_ACCOUNT_STATUSES,
    labelOf: (status) => t(STATUS_KEY[status]),
    endStatus: 'disabled',
  });
  // Cùng bộ lọc, kể cả hồ sơ cuối đời — để biết bảng trống có phải vì chúng đang ẩn (Q-20).
  const hiddenProbeQuery = buildFilterQuery({ ...filters, status: ALL_STATUSES }, []);
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
    // Đổi trang/từ khoá thì GIỮ bảng cũ tới khi có dữ liệu mới: vẽ lại Loading là gỡ cả bảng,
    // mất dòng đang bung/menu đang mở và bảng nháy trắng sau mỗi lần gõ tìm.
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiFetch<{ items: ServiceAccountRow[]; total: number }>(
        `/api/v1/service-accounts?${buildQuery(page, limit, filters, sorting)}`,
      ),
  });
  useClampPage(url, accounts.data?.total);

  /*
   * Hạn đổi mật khẩu trong két theo từng tài khoản (Q-15). Hỏi `vault` từ MÀN HÌNH, không từ
   * module `service-accounts`: `vault` đã phụ thuộc `service-accounts`, gọi ngược là vòng (AD-2).
   * Chỉ SA/Admin — bản đồ két không mở cho Member.
   */
  const due = useQuery({
    queryKey: ['vault', 'owners', 'due', 'service_account'],
    enabled: canEdit,
    queryFn: () =>
      apiFetch<{ ownerId: string; valueChangedAt: string; dueInDays: number }[]>(
        '/api/v1/vault/owners/due?ownerType=service_account',
      ),
  });
  const dueByOwner = useMemo(
    () => new Map((due.data ?? []).map((item) => [item.ownerId, item])),
    [due.data],
  );

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
          <span className={`badge ${KIND_TONE[row.original.kind]}`}>
            {t(KIND_SHORT_KEY[row.original.kind])}
          </span>
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
      /* Hạn dùng (Q-20). Ngừng dùng thì "Không tính hạn": nguồn hạn bên API không nhắc tài
         khoản đã ngừng dùng, màn này không được kêu "Quá hạn" trái với /expiry. */
      {
        id: 'endDate',
        header: t('serviceAccounts.endDate'),
        cell: ({ row }) => (
          <ExpiryBadge end={row.original.endDate} notCounted={row.original.status === 'disabled'} />
        ),
      },
      ...(canEdit
        ? [
            {
              id: 'secretDue',
              header: t('vault.changedCol'),
              cell: ({ row }) => {
                const item = dueByOwner.get(row.original.id);
                return <SecretDue changedAt={item?.valueChangedAt} dueInDays={item?.dueInDays} />;
              },
            } satisfies ColumnDef<ServiceAccountRow, unknown>,
          ]
        : []),
      ...(canEdit
        ? [
            {
              id: 'actions',
              header: t('common.actions'),
              meta: { className: 'col-center' },
              cell: ({ row }) => (
                <RowActions
                  primary={{
                    label: t('common.edit'),
                    ariaLabel: t('common.editOf', { subject: row.original.code }),
                    onClick: () => setEditing(row.original),
                  }}
                  label={t('common.actionsOf', { subject: row.original.code })}
                  items={[
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
                          warn: true,
                        }
                      : {
                          key: 'enable',
                          label: t('serviceAccounts.enable'),
                          onSelect: () =>
                            setSwitching({ row: row.original, next: 'active' }),
                          ok: true,
                        },
                  ]}
                />
              ),
            } as ColumnDef<ServiceAccountRow, unknown>,
          ]
        : []),
    ],
    [t, canEdit, dueByOwner],
  );

  return (
    <>
      <PageHeader
        title={t('serviceAccounts.title')}
        /* Cùng câu với trạng thái rỗng: có dữ liệu thì câu ấy không còn in ra nữa. */
        titleTip={t('serviceAccounts.emptyHint')}
        subtitle={t('serviceAccounts.subtitle')}
        actions={
          <>
            {/* FR-028: xuất đúng bộ lọc và thứ tự đang xem. File KHÔNG có mật khẩu (FR-026) —
                nó trả lời "công ty có những tài khoản dùng chung nào, ai giữ". */}
            <ExportXlsxButton
              url={`/api/v1/service-accounts/export.xlsx?${buildFilterQuery(filters, sorting)}`}
              fileName="tai-khoan-dich-vu.xlsx"
            />
            {canEdit ? (
              <button type="button" className="btn primary" onClick={() => setCreating(true)}>
                {t('serviceAccounts.add')}
              </button>
            ) : null}
          </>
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
          placeholder={statusOptions[0].label}
          options={statusOptions}
          onChange={(value) => setFilter('status', value as Filters['status'])}
        />
        {/* Tên chỉ là dòng phụ dưới mã nên không có tiêu đề cột để bấm — sắp theo tên đi ô này.
            API đã nhận `sort=name`. */}
        <Select
          value={url.sorting.key === 'name' ? 'name' : 'code'}
          ariaLabel={t('serviceAccounts.sortBy')}
          options={[
            { value: 'code', label: t('serviceAccounts.sortByCode') },
            { value: 'name', label: t('serviceAccounts.sortByName') },
          ]}
          onChange={(value) => url.setSorting({ key: value, desc: false })}
        />
        {/* VPN mở cho mọi IP là câu kiểm toán hỏi đầu tiên — một chip bật/tắt, cùng kiểu chip
            "Chỉ cổng nhạy cảm" của sổ NAT. */}
        <div className="segmented" role="group" aria-label={t('serviceAccounts.anyIpFilter')}>
          <button
            type="button"
            className={filters.anyIp ? 'on' : undefined}
            aria-pressed={filters.anyIp === '1'}
            onClick={() => setFilter('anyIp', filters.anyIp ? '' : '1')}
          >
            {t('serviceAccounts.anyIpOnly')}
          </button>
        </div>
      </FilterBar>

      {accounts.isLoading ? (
        <Loading />
      ) : accounts.isError ? (
        <LoadError error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : rows.length === 0 ? (
        <LifecycleHiddenEmpty
          probeKey={['service-accounts', 'hidden-probe', hiddenProbeQuery]}
          probeUrl={filters.status === '' ? `/api/v1/service-accounts?page=1&limit=1&${hiddenProbeQuery}` : null}
          endLabel={t(STATUS_KEY['disabled'])}
          allLabel={statusOptions[statusOptions.length - 1].label}
          onShowAll={() => setFilter('status', ALL_STATUSES)}
          fallback={
            <EmptyState
              /* HAI cảnh, HAI câu: "chưa khai gì" mời người dùng thêm bản ghi đầu tiên, "lọc không
                 ra" mời họ nới bộ lọc. Một câu cho cả hai thì hệ thống vừa cài xong báo "không khớp
                 bộ lọc" và người dùng đi tìm cái bộ lọc không tồn tại. Nút Thêm chỉ cho người
                 được thêm — mời Member bấm một nút rồi báo 403 là tệ hơn không mời. */
              title={url.isFiltered ? t('serviceAccounts.emptyFiltered') : t('serviceAccounts.empty')}
              hint={url.isFiltered ? t('serviceAccounts.emptyFilteredHint') : t('serviceAccounts.emptyHint')}
              action={
                url.isFiltered ? (
                  <button type="button" className="btn" onClick={url.clearFilters}>
                    {t('common.clearFilters')}
                  </button>
                ) : canEdit ? (
                  <button type="button" className="btn primary" onClick={() => setCreating(true)}>
                    {t('serviceAccounts.add')}
                  </button>
                ) : undefined
              }
            />
          }
        />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            emptyText={url.isFiltered ? t('serviceAccounts.emptyFiltered') : t('serviceAccounts.empty')}
            stackOnMobile
            /* Điện thoại: thẻ 2 dòng (mã + trạng thái; tên đăng nhập · loại · bộ phận) thay cho
               5 hàng nhãn–giá trị ~270px một tài khoản. */
            mobileCard={{
              title: (row) => row.code,
              titleIsCode: true,
              href: (row) => PATHS.serviceAccount(row.id),
              badge: (row) => (
                <span className={`badge ${STATUS_TONE[row.status]}`}>{t(STATUS_KEY[row.status])}</span>
              ),
              subtitle: (row) => row.name,
              meta: (row) =>
                [row.login, t(KIND_SHORT_KEY[row.kind]), row.department].filter(Boolean).join(' · '),
              aside: (row) => {
                const item = canEdit ? dueByOwner.get(row.id) : undefined;
                return item ? (
                  <SecretDue changedAt={item.valueChangedAt} dueInDays={item.dueInDays} />
                ) : null;
              },
            }}
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
        <ServiceAccountStatusDialog
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

function buildQuery(page: number, limit: number, filters: Filters, sorting: SortingState): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  return [params.toString(), buildFilterQuery(filters, sorting)].filter(Boolean).join('&');
}

/** Bộ lọc + thứ tự — CHUNG cho bảng và nút Xuất Excel, nên file luôn khớp cái đang xem. */
function buildFilterQuery(filters: Filters, sorting: SortingState): string {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.kind) params.set('kind', filters.kind);
  // Mặc định ẩn tài khoản đã ngừng dùng (Q-20): Kho thanh lý là nơi xem chúng; ⌘K không đi
  // qua đây nên vẫn tìm ra.
  if (filters.status !== 'all') params.set('status', filters.status || 'active');
  if (filters.anyIp) params.set('anyIp', 'true');
  return [params.toString(), sortQuery(sorting)].filter(Boolean).join('&');
}
