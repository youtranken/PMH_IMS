import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { FilterBar } from '@/ui/filter-bar';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { Select } from '@/ui/select';
import type { CatalogLists } from '@/features/catalog/catalog-types';
import { DeviceForm } from './device-form';
import { DeviceImportDialog } from './device-import-dialog';
import {
  DEVICE_STATUSES,
  STATUS_KEY,
  STATUS_TONE,
  locationLabel,
  type DeviceRow,
  type DeviceStatus,
} from './device-types';

const LIMIT = 20;

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
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const lists = useQuery({
    queryKey: ['catalog', 'lists'],
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
  });

  const devices = useQuery({
    queryKey: ['devices', page, filters],
    queryFn: () =>
      apiFetch<{ items: DeviceRow[]; total: number }>(
        `/api/v1/devices?${buildQuery(page, filters)}`,
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
            {/* FR-028: xuất đúng bộ lọc đang xem — cùng query với bảng bên dưới. */}
            <ExportXlsxButton
              url={`/api/v1/devices/export?${buildFilterQuery(filters)}`}
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
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>{t('devices.code')}</th>
                  <th>{t('devices.name')}</th>
                  <th>{t('devices.type')}</th>
                  <th>{t('devices.location')}</th>
                  <th>{t('devices.assignedTo')}</th>
                  <th>{t('devices.warranty')}</th>
                  <th>{t('devices.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((device) => (
                  <tr key={device.id}>
                    <td data-label={t('devices.code')}>
                      {/* Link thật (không phải onClick trên <tr>): mở tab mới, copy link được. */}
                      <Link className="mono" to={`/thiet-bi/${device.id}`}>
                        {device.code}
                      </Link>
                    </td>
                    <td data-label={t('devices.name')}>
                      {device.name}
                      {device.serial ? <span className="cell-sub mono">{device.serial}</span> : null}
                    </td>
                    <td data-label={t('devices.type')}>{device.deviceTypeName}</td>
                    <td data-label={t('devices.location')} className="mono">
                      {locationLabel(device)}
                    </td>
                    <td data-label={t('devices.assignedTo')}>
                      {orDash(device.assignedTo)}
                      {device.department ? (
                        <span className="cell-sub">{device.department}</span>
                      ) : null}
                    </td>
                    <td data-label={t('devices.warranty')}>
                      {/* AD-15: luật "sắp hết hạn" chỉ có một, ở lib/expiry.ts */}
                      <ExpiryBadge end={device.warrantyEnd} />
                    </td>
                    <td data-label={t('devices.status')}>
                      <span className={`badge ${STATUS_TONE[device.status]}`}>
                        {t(STATUS_KEY[device.status])}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            limit={LIMIT}
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
    </>
  );
}

function buildQuery(page: number, filters: Filters): string {
  const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
  const filterQuery = buildFilterQuery(filters);
  return filterQuery ? `${params.toString()}&${filterQuery}` : params.toString();
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
