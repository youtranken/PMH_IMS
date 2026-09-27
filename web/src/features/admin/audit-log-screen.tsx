import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { formatDateTime, orDash } from '@/lib/format';
import { DataTable } from '@/ui/data-table';
import { DatePicker } from '@/ui/date-picker';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { Select } from '@/ui/select';
import { useClampPage, useListUrlState } from '@/ui/use-list-url-state';

export interface AuditRow {
  id: string;
  actor: string;
  actorName: string | null;
  action: string;
  objectType: string | null;
  objectId: string | null;
  ip: string | null;
  detail: unknown;
  createdAt: string;
}

interface AuditPage {
  items: AuditRow[];
  total: number;
  totalCapped: boolean;
}

/*
 * `actor` là khoá tìm của hook, nên nó nằm trên URL dưới tên `q`. Thư cảnh báo bảo mật dựng
 * link `?q=<email>` (`UI_PATHS.auditLog` bên api) dựa đúng vào điều này.
 */
interface Filters extends Record<string, string> {
  actor: string;
  action: string;
  objectId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { actor: '', action: '', objectId: '', from: '', to: '' };

const DEFAULT_LIMIT = 20;

/** Tham số gửi API — tên khoá theo `AuditQueryDto` (`pageSize`, không phải `limit`). */
export function auditQuery(page: number, limit: number, filters: Filters): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(limit) });
  if (filters.actor.trim()) params.set('actor', filters.actor.trim());
  if (filters.action) params.set('action', filters.action);
  if (filters.objectId.trim()) params.set('objectId', filters.objectId.trim());
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return params.toString();
}

/**
 * `detail` là JSON tự do do từng module ghi. Hiện từng khoá một dòng; giá trị lồng nhau in
 * JSON có khoảng trắng để dòng dài còn xuống dòng được ở 390px thay vì đẩy ngang cả trang.
 */
export function detailLines(detail: unknown): string[] {
  if (detail === null || detail === undefined) return [];
  if (typeof detail !== 'object' || Array.isArray(detail)) return [JSON.stringify(detail, null, 1)];
  return Object.entries(detail as Record<string, unknown>).map(
    ([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value, null, 1)}`,
  );
}

/** Nhật ký an ninh (FR-43, NFR-03) — chỉ đọc, SA/Quản trị. */
export function AuditLogScreen() {
  const { t } = useTranslation();
  const url = useListUrlState<Filters>({
    emptyFilters: EMPTY_FILTERS,
    defaultLimit: DEFAULT_LIMIT,
    searchKey: 'actor',
  });
  const { page, limit, filters } = url;

  /*
   * Ô mã đối tượng ghi lên URL khi rời ô hoặc Enter, không theo từng phím: ô tìm có debounce
   * của hook đã dành cho người thao tác, còn mỗi phím ở đây là một lượt quét nhật ký.
   */
  const [objectDraft, setObjectDraft] = useState(filters.objectId);
  useEffect(() => setObjectDraft(filters.objectId), [filters.objectId]);
  const commitObject = () => {
    if (objectDraft.trim() !== filters.objectId) url.setFilter('objectId', objectDraft.trim());
  };

  const list = useQuery({
    queryKey: ['audit', page, limit, filters],
    queryFn: () =>
      apiFetch<AuditPage>(`/api/v1/admin/audit?${auditQuery(page, limit, filters)}`),
  });
  useClampPage(url, list.data?.total);
  const actions = useQuery({
    queryKey: ['audit', 'actions'],
    queryFn: () => apiFetch<string[]>('/api/v1/admin/audit/actions'),
  });

  const rows = list.data?.items ?? [];

  const columns = useMemo<ColumnDef<AuditRow, unknown>[]>(
    () => [
      {
        id: 'createdAt',
        header: t('audit.time'),
        enableSorting: false,
        cell: ({ row }) => <span className="mono">{formatDateTime(row.original.createdAt)}</span>,
      },
      {
        id: 'actor',
        header: t('audit.actor'),
        enableSorting: false,
        cell: ({ row }) => (
          <>
            {row.original.actorName ?? row.original.actor}
            {row.original.actorName ? (
              <span className="cell-sub">{row.original.actor}</span>
            ) : null}
          </>
        ),
      },
      {
        id: 'action',
        header: t('audit.action'),
        enableSorting: false,
        cell: ({ row }) => <span className="mono">{row.original.action}</span>,
      },
      {
        id: 'object',
        header: t('audit.object'),
        enableSorting: false,
        cell: ({ row }) => (
          <>
            {orDash(row.original.objectType)}
            {row.original.objectId ? (
              <span className="cell-sub mono">{row.original.objectId}</span>
            ) : null}
          </>
        ),
      },
      {
        id: 'ip',
        header: t('audit.ip'),
        enableSorting: false,
        cell: ({ row }) => <span className="mono">{orDash(row.original.ip)}</span>,
      },
    ],
    [t],
  );

  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />

      <FilterBar
        search={url.searchInput}
        onSearchChange={url.setSearchInput}
        searchPlaceholder={t('audit.searchActor')}
      >
        <Select
          value={filters.action}
          ariaLabel={t('audit.action')}
          placeholder={t('audit.allActions')}
          options={[
            { value: '', label: t('audit.allActions') },
            ...(actions.data ?? []).map((action) => ({ value: action, label: action })),
          ]}
          failed={actions.isError}
          onChange={(value) => url.setFilter('action', value)}
        />
        <input
          className="inp"
          type="search"
          value={objectDraft}
          aria-label={t('audit.objectId')}
          placeholder={t('audit.objectIdPlaceholder')}
          onChange={(event) => setObjectDraft(event.target.value)}
          onBlur={commitObject}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitObject();
          }}
        />
        <DatePicker
          value={filters.from}
          ariaLabel={t('audit.from')}
          placeholder={t('audit.from')}
          max={filters.to || undefined}
          onChange={(value) => url.setFilter('from', value)}
        />
        <DatePicker
          value={filters.to}
          ariaLabel={t('audit.to')}
          placeholder={t('audit.to')}
          min={filters.from || undefined}
          onChange={(value) => url.setFilter('to', value)}
        />
      </FilterBar>

      {list.isLoading ? (
        <Loading />
      ) : list.isError ? (
        <LoadError error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={url.isFiltered ? t('audit.emptyFiltered') : t('audit.empty')}
          hint={url.isFiltered ? t('audit.emptyFilteredHint') : t('audit.emptyHint')}
        />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            emptyText={url.isFiltered ? t('audit.emptyFiltered') : t('audit.empty')}
            stackOnMobile
            canExpand={(row) => detailLines(row.detail).length > 0}
            renderExpanded={(row) => (
              <div className="mono">
                {detailLines(row.detail).map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            )}
          />
          <Pagination
            page={page}
            limit={limit}
            onLimitChange={url.setLimit}
            total={list.data?.total ?? 0}
            onPageChange={url.setPage}
          />
          {list.data?.totalCapped ? <p className="muted">{t('audit.capped')}</p> : null}
        </>
      )}
    </>
  );
}
