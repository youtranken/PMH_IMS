import { PhoneLink } from '@/ui/phone-link';
import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { DataTable } from '@/ui/data-table';
import { sortQuery } from '@/lib/sort-query';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { useClampPage, useListUrlState } from '@/ui/use-list-url-state';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { Select } from '@/ui/select';
import { ALL_STATUSES, lifecycleStatusOptions } from '@/ui/lifecycle-status-options';
import { LifecycleHiddenEmpty } from '@/ui/lifecycle-hidden-empty';
import { IspForm } from './isp-form';
import { ISP_STATUSES, STATUS_KEY, STATUS_TONE, type IspRow, type IspStatus } from './isp-types';
import { PATHS } from '@/lib/routes';
import { useCatalogLists } from '@/ui/use-catalog-lists';
import { CopyButton } from '@/ui/copy-button';
import { RowActions } from '@/ui/row-actions';
import { ispMenuItems } from './isp-status-menu';

const DEFAULT_LIMIT = 20;

/* `[key: string]: string` để khớp ràng buộc của `useListUrlState` — hook đọc/ghi bộ lọc theo
   TÊN KHÓA lên URL nên nó phải duyệt được các khóa. `status` vẫn giữ union hẹp cho chỗ dùng. */
interface Filters extends Record<string, string> {
  search: string;
  siteId: string;
  providerId: string;
  /**
   * `''` (mặc định) = đường CÒN HIỆU LỰC (đang dùng + tạm ngưng): lúc sự cố người đọc không
   * phải lọc bằng mắt mấy đường đã thanh lý. `'all'` = mọi trạng thái.
   */
  status: '' | 'all' | IspStatus;
}

const EMPTY_FILTERS: Filters = {
  search: '',
  siteId: '',
  providerId: '',
  status: '',
};

/**
 * Danh sách đường truyền (FR-010).
 *
 * HOTLINE và SỐ HỢP ĐỒNG nằm ngay trên bảng, không giấu trong trang chi tiết — mục tiêu viết
 * rõ: "đứt cáp lúc 2h sáng có hotline + số hợp đồng trong 30 giây".
 */
export function IspScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  /*
   * Bộ lọc · trang · số dòng · cột sắp nằm trên THANH ĐỊA CHỈ, không trong `useState`. Nhờ
   * vậy: F5 giữ nguyên bộ lọc, gửi được link "đường truyền tạm ngưng ở chi nhánh X" cho đồng
   * nghiệp, và bấm Back từ trang chi tiết về ĐÚNG kết quả cũ thay vì một danh sách trắng.
   * Ô tìm có debounce 250ms để mỗi phím không thành một lượt gọi API.
   */
  const url = useListUrlState<Filters>({
    emptyFilters: EMPTY_FILTERS,
    defaultLimit: DEFAULT_LIMIT,
    defaultSort: { key: 'code', desc: false },
    searchKey: 'search',
    // `?status=abc` đọc ra mặc định (ẩn hồ sơ cuối đời), không gửi chữ lạ lên API (Q-20).
    allowed: { status: [...ISP_STATUSES, ALL_STATUSES] },
  });
  const { page, limit } = url;
  const filters = url.filters;
  const statusOptions = lifecycleStatusOptions(t, {
    statuses: ISP_STATUSES,
    labelOf: (status) => t(STATUS_KEY[status]),
    endStatus: 'terminated',
  });
  // Cùng bộ lọc, kể cả hồ sơ cuối đời — để biết bảng trống có phải vì chúng đang ẩn (Q-20).
  const hiddenProbeQuery = buildFilterQuery({ ...filters, status: ALL_STATUSES });
  // Sắp xếp chạy ở SERVER (`manualSorting`): danh sách phân trang 20 dòng/trang, sắp ở client
  // chỉ đảo chỗ 20 dòng đang xem mà trông như đã sắp cả sổ — sai mà không có dấu hiệu nào.
  const sorting: SortingState = [{ id: url.sorting.key, desc: url.sorting.desc }];
  const setPage = url.setPage;
  const setLimit = url.setLimit;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<IspRow | null>(null);
  const navigate = useNavigate();

  const lists = useCatalogLists();

  const lines = useQuery({
    queryKey: ['isp', page, limit, filters, sorting],
    // Đổi trang/từ khoá thì GIỮ bảng cũ tới khi có dữ liệu mới: vẽ lại Loading là gỡ cả bảng,
    // mất dòng đang bung và bảng nháy trắng sau mỗi lần gõ tìm.
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiFetch<{ items: IspRow[]; total: number }>(
        `/api/v1/isp-lines?${buildQuery(page, limit, filters, sorting)}`,
      ),
  });
  useClampPage(url, lines.data?.total);

  // Mọi bộ lọc đều đưa về trang 1 (hook tự xoá `page`): giữ nguyên trang 5 khi đổi lọc thì
  // bảng trông như rỗng.
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    url.setFilter(key, value as string);
  };

  const rows = lines.data?.items ?? [];

  /**
   * `id` của cột PHẢI khớp whitelist `ISP_SORT_KEYS` phía API — đó là tên cột gửi lên trong
   * `?sort=`. Cột Site (`siteCode`) không sắp được: tra qua CatalogApiService, sắp theo nó
   * đòi join sang bảng của module khác, vi phạm AD-2. Muốn theo site thì lọc rồi sắp theo mã.
   */
  const columns = useMemo<ColumnDef<IspRow, unknown>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('isp.code'),
        cell: ({ row }) => (
          <>
            <Link className="mono" to={PATHS.ispLine(row.original.id)}>
              {row.original.code}
            </Link>
            {/* IP WAN là câu thứ hai lúc mất mạng ("IP tĩnh của line này là gì") — dòng phụ
                ngay dưới mã, chép được, không phải mở trang chi tiết. Nhiều IP (Q-20): hiện IP
                đầu + "+N" để dòng không phình; rê chuột đọc đủ, trang chi tiết chép từng IP. */}
            {row.original.wanIps.length > 0 ? (
              <span className="cell-sub">
                <span className="mono">{row.original.wanIps[0]}</span>{' '}
                {row.original.wanIps.length > 1 ? (
                  <>
                    <span className="muted" title={row.original.wanIps.join(', ')}>
                      {t('isp.wanIpMore', { count: row.original.wanIps.length - 1 })}
                    </span>{' '}
                  </>
                ) : null}
                <CopyButton value={row.original.wanIps[0]} label={t('isp.copyWanIp')} inline />
              </span>
            ) : null}
          </>
        ),
      },
      {
        accessorKey: 'provider',
        header: t('isp.provider'),
        cell: ({ row }) => (
          <>
            {row.original.provider}
            {row.original.bandwidth ? (
              <span className="cell-sub">{row.original.bandwidth}</span>
            ) : null}
          </>
        ),
      },
      /* `mono` đặt lên CHÍNH giá trị, không lên `<td>`: đặt lên ô thì dấu "—" của ô rỗng và cả
         nhãn `data-label` ở thẻ dọc điện thoại cũng thành mono, lệch hẳn các cột khác. */
      {
        id: 'siteCode',
        header: t('isp.site'),
        cell: ({ row }) =>
          row.original.siteCode ? <span className="mono">{row.original.siteCode}</span> : orDash(null),
      },
      {
        // Không sắp được — mã thiết bị tra qua DevicesApiService, sắp theo nó đòi join sang
        // bảng của module khác (AD-2), cùng lý do cột Site.
        id: 'deviceCode',
        header: t('isp.device'),
        cell: ({ row }) =>
          row.original.deviceId ? (
            <Link className="mono" to={PATHS.device(row.original.deviceId)}>
              {row.original.deviceCode}
            </Link>
          ) : (
            orDash(null)
          ),
      },
      {
        accessorKey: 'hotline',
        header: t('isp.hotline'),
        cell: ({ row }) =>
          row.original.hotline ? (
            // Bấm gọi thẳng từ điện thoại — màn này hay được mở ở 390px.
            <PhoneLink value={row.original.hotline} />
          ) : (
            '—'
          ),
      },
      {
        accessorKey: 'contractNo',
        header: t('isp.contractNo'),
        cell: ({ row }) =>
          row.original.contractNo ? (
            <span className="mono">{row.original.contractNo}</span>
          ) : (
            orDash(null)
          ),
      },
      {
        accessorKey: 'status',
        header: t('isp.status'),
        cell: ({ row }) => (
          <span className={`badge ${STATUS_TONE[row.original.status]}`}>
            {t(STATUS_KEY[row.original.status])}
          </span>
        ),
      },
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
            subject={row.original.code}
            /* Đổi trạng thái đi sang trang chi tiết (`?action=`): câu hỏi lại của Thanh lý nhắc
               hủy mật khẩu trong két, và chỉ trang chi tiết đếm ngăn két của đường này. */
            items={ispMenuItems(t, row.original.status, (next) =>
              navigate(`${PATHS.ispLine(row.original.id)}?action=${next}`),
            )}
          />
        ),
      },
    ],
    [t, navigate],
  );

  return (
    <>
      <PageHeader
        title={t('isp.title')}
        subtitle={t('isp.subtitle')}
        actions={
          <>
            {/* FR-028: xuất đúng bộ lọc VÀ đúng thứ tự đang xem — cùng query với bảng dưới. */}
            <ExportXlsxButton
              url={`/api/v1/isp-lines/export.xlsx?${[buildFilterQuery(filters), sortQuery(sorting)]
                .filter(Boolean)
                .join('&')}`}
              fileName="duong-truyen.xlsx"
            />
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>
              {t('isp.add')}
            </button>
          </>
        }
      />

      <FilterBar
        search={url.searchInput}
        onSearchChange={url.setSearchInput}
        searchPlaceholder={t('isp.search')}
      >
        <Select
          value={filters.siteId}
          ariaLabel={t('isp.site')}
          placeholder={t('isp.allSites')}
          options={[
            { value: '', label: t('isp.allSites') },
            ...(lists.data?.sites ?? []).map((site) => ({ value: site.id, label: site.code })),
          ]}
          failed={lists.isError}
          onChange={(value) => setFilter('siteId', value)}
        />
        <Select
          value={filters.providerId}
          ariaLabel={t('isp.provider')}
          placeholder={t('isp.allProviders')}
          options={[
            { value: '', label: t('isp.allProviders') },
            ...(lists.data?.ispProviders ?? []).map((provider) => ({
              value: provider.id,
              label: provider.name,
            })),
          ]}
          failed={lists.isError}
          onChange={(value) => setFilter('providerId', value)}
        />
        <Select
          value={filters.status}
          ariaLabel={t('isp.status')}
          placeholder={statusOptions[0].label}
          options={statusOptions}
          onChange={(value) => setFilter('status', value as Filters['status'])}
        />
      </FilterBar>

      {lines.isLoading ? (
        <Loading />
      ) : lines.isError ? (
        <LoadError error={lines.error} onRetry={() => void lines.refetch()} />
      ) : rows.length === 0 ? (
        <LifecycleHiddenEmpty
          probeKey={['isp-lines', 'hidden-probe', hiddenProbeQuery]}
          probeUrl={filters.status === '' ? `/api/v1/isp-lines?page=1&limit=1&${hiddenProbeQuery}` : null}
          endLabel={t(STATUS_KEY['terminated'])}
          allLabel={statusOptions[statusOptions.length - 1].label}
          onShowAll={() => setFilter('status', ALL_STATUSES)}
          fallback={
            <EmptyState
              /* HAI cảnh, HAI câu: "chưa khai gì" mời người dùng thêm bản ghi đầu tiên, "lọc không
                 ra" mời họ nới bộ lọc. Một câu cho cả hai thì hệ thống vừa cài xong báo "không khớp
                 bộ lọc" và người dùng đi tìm cái bộ lọc không tồn tại. Kèm NÚT làm đúng việc câu
                 gợi ý nói, thay vì bắt người dùng đi tìm nút đó ở chỗ khác. */
              title={url.isFiltered ? t('isp.emptyFiltered') : t('isp.empty')}
              hint={url.isFiltered ? t('isp.emptyFilteredHint') : t('isp.emptyHint')}
              action={
                url.isFiltered ? (
                  <button type="button" className="btn" onClick={url.clearFilters}>
                    {t('common.clearFilters')}
                  </button>
                ) : (
                  <button type="button" className="btn primary" onClick={() => setCreating(true)}>
                    {t('isp.add')}
                  </button>
                )
              }
            />
          }
        />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            emptyText={url.isFiltered ? t('isp.emptyFiltered') : t('isp.empty')}
            stackOnMobile
            /* Màn này hay được mở trên điện thoại lúc mất mạng: thẻ gọn với nút gọi hotline ở
               góc thay cho bảng gập bảy dòng toàn nhãn. */
            mobileCard={{
              title: (row) => row.code,
              titleIsCode: true,
              href: (row) => PATHS.ispLine(row.id),
              badge: (row) => (
                <span className={`badge ${STATUS_TONE[row.status]}`}>{t(STATUS_KEY[row.status])}</span>
              ),
              subtitle: (row) => [row.provider, row.bandwidth].filter(Boolean).join(' · '),
              meta: (row) =>
                [row.siteCode, row.deviceCode, row.wanIps.join(', ')].filter(Boolean).join(' · '),
              aside: (row) => (row.hotline ? <PhoneLink value={row.hotline} /> : null),
            }}
            // Tạm ngưng: vạch cam ở mép trái — đường đang "nửa sống" là thứ phải thấy từ xa.
            rowClassName={(row) => (row.status === 'suspended' ? 'row-suspended' : '')}
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
            total={lines.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

      {editing ? (
        <IspForm
          row={editing}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['isp'] });
          }}
        />
      ) : null}

      {creating ? (
        <IspForm
          row={null}
          csrfToken={me.csrfToken}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['isp'] });
          }}
        />
      ) : null}
    </>
  );
}

function buildQuery(page: number, limit: number, filters: Filters, sorting: SortingState): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  return [params.toString(), buildFilterQuery(filters), sortQuery(sorting)]
    .filter(Boolean)
    .join('&');
}

/**
 * Phần lọc (không kèm phân trang) — dùng CHUNG cho danh sách và cho nút Xuất Excel, nên
 * file xuất ra luôn khớp đúng cái đang nhìn thấy (FR-028).
 */
function buildFilterQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.siteId) params.set('siteId', filters.siteId);
  if (filters.providerId) params.set('providerId', filters.providerId);
  // Mặc định: chỉ đường còn hiệu lực. `all` thì không gửi gì — API trả mọi trạng thái.
  if (filters.status === '') params.set('status', 'active,suspended');
  else if (filters.status !== 'all') params.set('status', filters.status);
  return params.toString();
}
