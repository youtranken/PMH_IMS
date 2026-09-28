import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
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
import { IspForm } from './isp-form';
import { ISP_STATUSES, STATUS_KEY, STATUS_TONE, type IspRow, type IspStatus } from './isp-types';
import { PATHS } from '@/lib/routes';
import { useCatalogLists } from '@/ui/use-catalog-lists';

const DEFAULT_LIMIT = 20;

/* `[key: string]: string` để khớp ràng buộc của `useListUrlState` — hook đọc/ghi bộ lọc theo
   TÊN KHÓA lên URL nên nó phải duyệt được các khóa. `status` vẫn giữ union hẹp cho chỗ dùng. */
interface Filters extends Record<string, string> {
  search: string;
  siteId: string;
  status: '' | IspStatus;
}

const EMPTY_FILTERS: Filters = {
  search: '',
  siteId: '',
  status: '',
};

/**
 * Danh sách đường truyền (story 3.3, FR-010).
 *
 * HOTLINE và SỐ HỢP ĐỒNG nằm ngay trên bảng, không giấu trong trang chi tiết — mục tiêu của
 * story viết rõ: "đứt cáp lúc 2h sáng có hotline + số hợp đồng trong 30 giây".
 */
export function IspScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  /*
   * Bộ lọc · trang · số dòng · cột sắp nằm trên THANH ĐỊA CHỈ, không trong `useState` nữa
   * (17/09/2026). Nhờ vậy: F5 giữ nguyên bộ lọc, gửi được link "đường truyền tạm ngưng ở
   * chi nhánh X" cho đồng nghiệp, và bấm Back từ trang chi tiết về ĐÚNG kết quả cũ thay vì
   * một danh sách trắng. Ô tìm cũng có debounce 250ms — trước đây mỗi phím là một lượt gọi API.
   */
  const url = useListUrlState<Filters>({
    emptyFilters: EMPTY_FILTERS,
    defaultLimit: DEFAULT_LIMIT,
    defaultSort: { key: 'code', desc: false },
    searchKey: 'search',
  });
  const { page, limit } = url;
  const filters = url.filters;
  // Sắp xếp chạy ở SERVER (`manualSorting`): danh sách phân trang 20 dòng/trang, sắp ở client
  // chỉ đảo chỗ 20 dòng đang xem mà trông như đã sắp cả sổ — sai mà không có dấu hiệu nào.
  const sorting: SortingState = [{ id: url.sorting.key, desc: url.sorting.desc }];
  const setPage = url.setPage;
  const setLimit = url.setLimit;
  const [creating, setCreating] = useState(false);

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
          <Link className="mono" to={PATHS.ispLine(row.original.id)}>
            {row.original.code}
          </Link>
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
      {
        id: 'siteCode',
        header: t('isp.site'),
        meta: { className: 'mono' },
        cell: ({ row }) => orDash(row.original.siteCode),
      },
      {
        accessorKey: 'hotline',
        header: t('isp.hotline'),
        cell: ({ row }) =>
          row.original.hotline ? (
            // Bấm gọi thẳng từ điện thoại — màn này hay được mở ở 390px.
            <a className="mono" href={`tel:${row.original.hotline.replace(/\s/g, '')}`}>
              {row.original.hotline}
            </a>
          ) : (
            '—'
          ),
      },
      {
        accessorKey: 'contractNo',
        header: t('isp.contractNo'),
        meta: { className: 'mono' },
        cell: ({ row }) => orDash(row.original.contractNo),
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
    ],
    [t],
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
          value={filters.status}
          ariaLabel={t('isp.status')}
          placeholder={t('isp.allStatuses')}
          options={[
            { value: '', label: t('isp.allStatuses') },
            ...ISP_STATUSES.map((status) => ({ value: status, label: t(STATUS_KEY[status]) })),
          ]}
          onChange={(value) => setFilter('status', value as Filters['status'])}
        />
      </FilterBar>

      {lines.isLoading ? (
        <Loading />
      ) : lines.isError ? (
        <LoadError error={lines.error} onRetry={() => void lines.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          /* HAI cảnh, HAI câu: "chưa khai gì" mời người dùng thêm bản ghi đầu tiên, "lọc không
             ra" mời họ nới bộ lọc. Một câu cho cả hai thì hệ thống vừa cài xong báo "không khớp
             bộ lọc" và người dùng đi tìm cái bộ lọc không tồn tại. */
          title={url.isFiltered ? t('isp.emptyFiltered') : t('isp.empty')}
          hint={url.isFiltered ? t('isp.emptyFilteredHint') : t('isp.emptyHint')}
        />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            emptyText={url.isFiltered ? t('isp.emptyFiltered') : t('isp.empty')}
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
            total={lines.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

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
  if (filters.status) params.set('status', filters.status);
  return params.toString();
}
