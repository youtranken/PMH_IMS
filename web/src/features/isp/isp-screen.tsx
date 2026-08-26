import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { DataTable } from '@/ui/data-table';
import { sortQuery } from '@/lib/sort-query';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { Select } from '@/ui/select';
import type { CatalogLists } from '@/features/catalog/catalog-types';
import { IspForm } from './isp-form';
import { ISP_STATUSES, STATUS_KEY, STATUS_TONE, type IspRow, type IspStatus } from './isp-types';

const LIMIT = 20;

interface Filters {
  search: string;
  siteId: string;
  status: '' | IspStatus;
}

/**
 * Danh sách đường truyền (story 3.3, FR-010).
 *
 * HOTLINE và SỐ HỢP ĐỒNG nằm ngay trên bảng, không giấu trong trang chi tiết — mục tiêu của
 * story viết rõ: "đứt cáp lúc 2h sáng có hotline + số hợp đồng trong 30 giây".
 */
export function IspScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({ search: '', siteId: '', status: '' });
  // Sắp xếp chạy ở SERVER (`manualSorting`): danh sách phân trang 20 dòng/trang, sắp ở client
  // chỉ đảo chỗ 20 dòng đang xem mà trông như đã sắp cả sổ — sai mà không có dấu hiệu nào.
  const [sorting, setSorting] = useState<SortingState>([{ id: 'code', desc: false }]);
  const [creating, setCreating] = useState(false);

  const lists = useQuery({
    queryKey: ['catalog', 'lists'],
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
  });

  const lines = useQuery({
    queryKey: ['isp', page, filters, sorting],
    queryFn: () =>
      apiFetch<{ items: IspRow[]; total: number }>(
        `/api/v1/isp-lines?${buildQuery(page, filters, sorting)}`,
      ),
  });

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
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
          <Link className="mono" to={`/duong-truyen/${row.original.id}`}>
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
        accessorKey: 'endDate',
        header: t('isp.expiry'),
        cell: ({ row }) => <ExpiryBadge end={row.original.endDate} />,
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
        search={filters.search}
        onSearchChange={(value) => setFilter('search', value)}
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
        <LoadError onRetry={() => void lines.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('isp.empty')} hint={t('isp.emptyHint')} />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            emptyText={t('isp.empty')}
            stackOnMobile
            manualSorting
            sorting={sorting}
            onSortingChange={(updater) => {
              setSorting((current) =>
                typeof updater === 'function' ? updater(current) : updater,
              );
              // Đổi cột sắp xếp thì về trang 1: giữ nguyên trang 5 của thứ tự CŨ là nhìn vào
              // một lát cắt chẳng liên quan gì tới thứ tự vừa chọn.
              setPage(1);
            }}
          />

          <Pagination
            page={page}
            limit={LIMIT}
            total={lines.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

      {creating ? (
        <IspForm
          row={null}
          lists={lists.data}
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

function buildQuery(page: number, filters: Filters, sorting: SortingState): string {
  const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
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
