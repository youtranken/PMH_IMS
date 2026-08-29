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
import { FilterBar } from '@/ui/filter-bar';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { Select } from '@/ui/select';
import type { CatalogLists } from '@/lib/catalog-types';
import { DeviceLicensesExpand } from '@/features/software/device-licenses-expand';
import { DeviceForm } from './device-form';
import { DeviceImportDialog } from './device-import-dialog';
import {
  DEVICE_STATUSES,
  STATUS_KEY,
  STATUS_TONE,
  locationLabel,
  type DeviceRow,
  type DeviceStatus,
} from '@/lib/device-types';
import { PATHS } from '@/lib/routes';

const DEFAULT_LIMIT = 20;

interface Filters {
  search: string;
  siteId: string;
  cabinetId: string;
  deviceTypeId: string;
  status: '' | DeviceStatus;
}

const EMPTY_FILTERS: Filters = {
  search: '',
  siteId: '',
  cabinetId: '',
  deviceTypeId: '',
  status: '',
};

/** Kho thiết bị (story 2.2) — lọc theo site/tủ/loại/trạng thái, tìm theo mã/tên/serial/model. */
export function DevicesScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  /** Số dòng/trang do NGƯỜI DÙNG chọn (10/20/50/100), không còn là hằng số cứng. */
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // Sắp xếp chạy ở SERVER (`manualSorting`): danh sách phân trang 20 dòng/trang, sắp ở client
  // chỉ đảo chỗ 20 dòng đang xem mà trông như đã sắp cả kho — sai mà không có dấu hiệu nào.
  const [sorting, setSorting] = useState<SortingState>([{ id: 'code', desc: false }]);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<DeviceRow | null>(null);

  const lists = useQuery({
    queryKey: ['catalog', 'lists'],
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
  });

  const devices = useQuery({
    queryKey: ['devices', page, limit, filters, sorting],
    queryFn: () =>
      apiFetch<{ items: DeviceRow[]; total: number }>(
        `/api/v1/devices?${buildQuery(page, limit, filters, sorting)}`,
      ),
  });

  // Mọi bộ lọc đều đưa về trang 1: giữ nguyên trang 5 khi đổi lọc thì bảng trông như rỗng.
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) =>
      key === 'siteId' ? { ...current, siteId: value as string, cabinetId: '' } : { ...current, [key]: value },
    );
    setPage(1);
  };

  const cabinets = (lists.data?.cabinets ?? []).filter(
    (cabinet) => !filters.siteId || cabinet.siteId === filters.siteId,
  );
  const rows = devices.data?.items ?? [];

  /**
   * Máy nào đang cài license — hỏi MỘT lượt cho cả trang (không N+1) để biết dòng nào đáng
   * mọc mũi tên bung. Mũi tên bấm ra rỗng cũng là một kiểu hứa hão, đúng như bảng phần mềm
   * đã tránh.
   *
   * Hỏi qua module `software`: `devices` không được biết license là gì (AD-2).
   */
  const deviceIds = rows.map((row) => row.id);
  const installedCounts = useQuery({
    queryKey: ['software', 'installed', 'counts', deviceIds],
    enabled: deviceIds.length > 0,
    queryFn: () =>
      apiFetch<Record<string, number>>(
        `/api/v1/software/installed/counts?deviceIds=${deviceIds.join(',')}`,
      ),
  });

  /**
   * `id` của cột PHẢI khớp whitelist `DEVICE_SORT_KEYS` phía API — đó là tên cột gửi lên
   * trong `?sort=`. Cột hiển thị qua danh mục (Loại, Vị trí) không sắp được: sắp theo chúng
   * đòi join sang bảng của module khác, vi phạm AD-2. Muốn theo site thì lọc rồi sắp theo mã.
   */
  const columns = useMemo<ColumnDef<DeviceRow, unknown>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('devices.code'),
        cell: ({ row }) => (
          // Link thật (không phải onClick trên <tr>): mở tab mới, copy link được.
          <Link className="mono" to={PATHS.device(row.original.id)}>
            {row.original.code}
          </Link>
        ),
      },
      {
        accessorKey: 'name',
        header: t('devices.name'),
        cell: ({ row }) => (
          <>
            {row.original.name}
            {row.original.serial ? (
              <span className="cell-sub mono">{row.original.serial}</span>
            ) : null}
          </>
        ),
      },
      {
        id: 'deviceTypeName',
        header: t('devices.type'),
        cell: ({ row }) => row.original.deviceTypeName,
      },
      {
        id: 'location',
        header: t('devices.location'),
        meta: { className: 'mono' },
        cell: ({ row }) => locationLabel(row.original),
      },
      {
        accessorKey: 'assignedTo',
        header: t('devices.assignedTo'),
        cell: ({ row }) => (
          <>
            {orDash(row.original.assignedTo)}
            {row.original.department ? (
              <span className="cell-sub">{row.original.department}</span>
            ) : null}
          </>
        ),
      },
      {
        accessorKey: 'warrantyEnd',
        header: t('devices.warranty'),
        // AD-15: luật "sắp hết hạn" chỉ có một, ở lib/expiry.ts
        cell: ({ row }) => <ExpiryBadge end={row.original.warrantyEnd} />,
      },
      {
        accessorKey: 'status',
        header: t('devices.status'),
        cell: ({ row }) => (
          <span className={`badge ${STATUS_TONE[row.original.status]}`}>
            {t(STATUS_KEY[row.original.status])}
          </span>
        ),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        cell: ({ row }) => (
          // Sửa NGAY TRÊN DANH SÁCH: đổi người giữ máy hay hạn bảo hành là việc lặt vặt
          // hằng ngày, bắt vào trang chi tiết rồi quay ra là ba lần chuyển trang cho một ô.
          // Mở đúng hộp "Thêm thiết bị" (AD-15) — cùng bộ trường, chỉ khác đã điền sẵn.
          <button
            type="button"
            className="btn sm"
            aria-label={t('devices.editOf', { device: row.original.code })}
            onClick={(event) => {
              event.stopPropagation();
              setEditing(row.original);
            }}
          >
            {t('common.edit')}
          </button>
        ),
      },
    ],
    [t],
  );

  return (
    <>
      <PageHeader
        title={t('devices.title')}
        subtitle={t('devices.subtitle')}
        actions={
          <>
            <ExportXlsxButton
              url="/api/v1/devices/template"
              fileName="mau-thiet-bi.xlsx"
              label={t('devices.downloadTemplate')}
            />
            {/* FR-028: xuất đúng bộ lọc VÀ đúng thứ tự đang xem — cùng query với bảng dưới. */}
            <ExportXlsxButton
              url={`/api/v1/devices/export?${[buildFilterQuery(filters), sortQuery(sorting)]
                .filter(Boolean)
                .join('&')}`}
              fileName="thiet-bi.xlsx"
            />
            <button type="button" className="btn" onClick={() => setImporting(true)}>
              {t('devices.importExcel')}
            </button>
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>
              {t('devices.add')}
            </button>
          </>
        }
      />

      <FilterBar
        search={filters.search}
        onSearchChange={(value) => setFilter('search', value)}
        searchPlaceholder={t('devices.search')}
      >
        <Select
          value={filters.siteId}
          ariaLabel={t('devices.site')}
          placeholder={t('devices.allSites')}
          options={[
            { value: '', label: t('devices.allSites') },
            ...(lists.data?.sites ?? []).map((site) => ({ value: site.id, label: site.code })),
          ]}
          onChange={(value) => setFilter('siteId', value)}
        />
        <Select
          value={filters.cabinetId}
          ariaLabel={t('devices.cabinet')}
          placeholder={t('devices.allCabinets')}
          options={[
            { value: '', label: t('devices.allCabinets') },
            ...cabinets.map((cabinet) => ({
              value: cabinet.id,
              label: `${cabinet.siteCode} · ${cabinet.code}`,
            })),
          ]}
          onChange={(value) => setFilter('cabinetId', value)}
        />
        <Select
          value={filters.deviceTypeId}
          ariaLabel={t('devices.type')}
          placeholder={t('devices.allTypes')}
          options={[
            { value: '', label: t('devices.allTypes') },
            ...(lists.data?.deviceTypes ?? []).map((type) => ({
              value: type.id,
              label: type.name,
            })),
          ]}
          onChange={(value) => setFilter('deviceTypeId', value)}
        />
        <Select
          value={filters.status}
          ariaLabel={t('devices.status')}
          placeholder={t('devices.allStatuses')}
          options={[
            { value: '', label: t('devices.allStatuses') },
            ...DEVICE_STATUSES.map((status) => ({
              value: status,
              label: t(STATUS_KEY[status]),
            })),
          ]}
          onChange={(value) => setFilter('status', value as Filters['status'])}
        />
      </FilterBar>

      {devices.isLoading ? (
        <Loading />
      ) : devices.isError ? (
        <LoadError onRetry={() => void devices.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('devices.empty')} hint={t('devices.emptyHint')} />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            emptyText={t('devices.empty')}
            stackOnMobile
            /* Bung dòng ra là thấy máy này đang cài license nào — cùng nếp với danh sách
               phần mềm. Chỉ hiện mũi tên khi thật sự có phần mềm đang cài. */
            canExpand={(item) => (installedCounts.data?.[item.id] ?? 0) > 0}
            renderExpanded={(item) => <DeviceLicensesExpand deviceId={item.id} />}
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
            limit={limit}
            onLimitChange={setLimit}
            total={devices.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

      {importing ? (
        <DeviceImportDialog
          csrfToken={me.csrfToken}
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            void queryClient.invalidateQueries({ queryKey: ['devices'] });
          }}
        />
      ) : null}

      {creating ? (
        <DeviceForm
          device={null}
          lists={lists.data}
          csrfToken={me.csrfToken}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['devices'] });
          }}
        />
      ) : null}

      {editing ? (
        // Cùng một `DeviceForm` với nút "Thêm thiết bị" — truyền `device` vào là nó tự đổi
        // sang PATCH và điền sẵn. AD-15: không có bản "form sửa" thứ hai để trôi lệch.
        <DeviceForm
          device={editing}
          lists={lists.data}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['devices'] });
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
  if (filters.cabinetId) params.set('cabinetId', filters.cabinetId);
  if (filters.deviceTypeId) params.set('deviceTypeId', filters.deviceTypeId);
  if (filters.status) params.set('status', filters.status);
  return params.toString();
}
