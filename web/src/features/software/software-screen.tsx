import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { Select } from '@/ui/select';
import type { CatalogLists } from '@/features/catalog/catalog-types';
import { SoftwareForm } from './software-form';
import {
  KIND_KEY,
  SOFTWARE_KINDS,
  SOFTWARE_STATUSES,
  STATUS_KEY,
  STATUS_TONE,
  seatLabel,
  type SoftwareKind,
  type SoftwareRow,
  type SoftwareStatus,
} from './software-types';

const LIMIT = 20;

interface Filters {
  search: string;
  kind: '' | SoftwareKind;
  status: '' | SoftwareStatus;
}

const EMPTY_FILTERS: Filters = { search: '', kind: '', status: '' };

/** Danh sách phần mềm (story 3.1, FR-008/FR-009) — lọc theo loại, cột tình trạng hạn. */
export function SoftwareScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [creating, setCreating] = useState(false);

  const lists = useQuery({
    queryKey: ['catalog', 'lists'],
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
  });

  const software = useQuery({
    queryKey: ['software', page, filters],
    queryFn: () =>
      apiFetch<{ items: SoftwareRow[]; total: number }>(
        `/api/v1/software?${buildQuery(page, filters)}`,
      ),
  });

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    // Đổi bộ lọc mà giữ nguyên trang 5 thì bảng trông như rỗng.
    setPage(1);
  };

  const rows = software.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t('software.title')}
        subtitle={t('software.subtitle')}
        actions={
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            {t('software.add')}
          </button>
        }
      />

      <FilterBar
        search={filters.search}
        onSearchChange={(value) => setFilter('search', value)}
        searchPlaceholder={t('software.search')}
      >
        <Select
          value={filters.kind}
          ariaLabel={t('software.kind')}
          placeholder={t('software.allKinds')}
          options={[
            { value: '', label: t('software.allKinds') },
            ...SOFTWARE_KINDS.map((kind) => ({ value: kind, label: t(KIND_KEY[kind]) })),
          ]}
          onChange={(value) => setFilter('kind', value as Filters['kind'])}
        />
        <Select
          value={filters.status}
          ariaLabel={t('software.status')}
          placeholder={t('software.allStatuses')}
          options={[
            { value: '', label: t('software.allStatuses') },
            ...SOFTWARE_STATUSES.map((status) => ({
              value: status,
              label: t(STATUS_KEY[status]),
            })),
          ]}
          onChange={(value) => setFilter('status', value as Filters['status'])}
        />
      </FilterBar>

      {software.isLoading ? (
        <Loading />
      ) : software.isError ? (
        <LoadError onRetry={() => void software.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('software.empty')} hint={t('software.emptyHint')} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>{t('software.code')}</th>
                  <th>{t('software.name')}</th>
                  <th>{t('software.kind')}</th>
                  <th>{t('software.vendor')}</th>
                  <th>{t('software.seats')}</th>
                  <th>{t('software.expiry')}</th>
                  <th>{t('software.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('software.code')}>
                      <Link className="mono" to={`/phan-mem/${row.id}`}>
                        {row.code}
                      </Link>
                    </td>
                    <td data-label={t('software.name')}>{row.name}</td>
                    <td data-label={t('software.kind')}>{t(KIND_KEY[row.kind])}</td>
                    <td data-label={t('software.vendor')}>{orDash(row.vendorName)}</td>
                    <td data-label={t('software.seats')} className="mono">
                      {seatLabel(row)}
                    </td>
                    <td data-label={t('software.expiry')}>
                      {/* AD-15: luật "sắp hết hạn" chỉ có một, ở lib/expiry.ts */}
                      <ExpiryBadge end={row.endDate} />
                    </td>
                    <td data-label={t('software.status')}>
                      <span className={`badge ${STATUS_TONE[row.status]}`}>
                        {t(STATUS_KEY[row.status])}
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
            total={software.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

      {creating ? (
        <SoftwareForm
          row={null}
          lists={lists.data}
          csrfToken={me.csrfToken}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['software'] });
          }}
        />
      ) : null}
    </>
  );
}

function buildQuery(page: number, filters: Filters): string {
  const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.status) params.set('status', filters.status);
  return params.toString();
}
