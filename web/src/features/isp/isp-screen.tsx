import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
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
  const [creating, setCreating] = useState(false);

  const lists = useQuery({
    queryKey: ['catalog', 'lists'],
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
  });

  const lines = useQuery({
    queryKey: ['isp', page, filters],
    queryFn: () =>
      apiFetch<{ items: IspRow[]; total: number }>(`/api/v1/isp-lines?${buildQuery(page, filters)}`),
  });

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const rows = lines.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t('isp.title')}
        subtitle={t('isp.subtitle')}
        actions={
          <>
            <ExportXlsxButton
              url={`/api/v1/isp-lines/export.xlsx?${buildQuery(1, filters)}`}
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
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>{t('isp.code')}</th>
                  <th>{t('isp.provider')}</th>
                  <th>{t('isp.site')}</th>
                  <th>{t('isp.hotline')}</th>
                  <th>{t('isp.contractNo')}</th>
                  <th>{t('isp.expiry')}</th>
                  <th>{t('isp.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('isp.code')}>
                      <Link className="mono" to={`/duong-truyen/${row.id}`}>
                        {row.code}
                      </Link>
                    </td>
                    <td data-label={t('isp.provider')}>
                      {row.provider}
                      {row.bandwidth ? <span className="cell-sub">{row.bandwidth}</span> : null}
                    </td>
                    <td data-label={t('isp.site')} className="mono">
                      {orDash(row.siteCode)}
                    </td>
                    <td data-label={t('isp.hotline')}>
                      {row.hotline ? (
                        // Bấm gọi thẳng từ điện thoại — màn này hay được mở ở 390px.
                        <a className="mono" href={`tel:${row.hotline.replace(/\s/g, '')}`}>
                          {row.hotline}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td data-label={t('isp.contractNo')} className="mono">
                      {orDash(row.contractNo)}
                    </td>
                    <td data-label={t('isp.expiry')}>
                      <ExpiryBadge end={row.endDate} />
                    </td>
                    <td data-label={t('isp.status')}>
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

function buildQuery(page: number, filters: Filters): string {
  const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.siteId) params.set('siteId', filters.siteId);
  if (filters.status) params.set('status', filters.status);
  return params.toString();
}
