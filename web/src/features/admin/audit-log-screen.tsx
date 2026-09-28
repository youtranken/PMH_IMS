import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { formatDateTime, orDash } from '@/lib/format';
import { CopyButton } from '@/ui/copy-button';
import { DataTable, type MobileCard } from '@/ui/data-table';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { Select } from '@/ui/select';
import { useClampPage, useListUrlState } from '@/ui/use-list-url-state';
import {
  OBJECT_TYPE_KEY,
  auditActionLabel,
  auditActionTone,
  objectTypeLabel,
} from './audit-actions';
import { detailChanges } from './audit-detail';

export interface AuditRow {
  id: string;
  actor: string;
  actorName: string | null;
  action: string;
  objectType: string | null;
  objectId: string | null;
  /** Nhãn do module chủ sở hữu gọi tên (email, mã thiết bị…); `null` = chỉ còn UUID. */
  objectLabel?: string | null;
  objectPath?: string | null;
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
  objectType: string;
  objectId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = {
  actor: '',
  action: '',
  objectType: '',
  objectId: '',
  from: '',
  to: '',
};

const DEFAULT_LIMIT = 20;

/** Tham số bộ lọc gửi API — tên khoá theo `AuditQueryDto`. Dùng chung cho danh sách và file xuất. */
function filterParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.actor.trim()) params.set('actor', filters.actor.trim());
  if (filters.action) params.set('action', filters.action);
  if (filters.objectType) params.set('objectType', filters.objectType);
  if (filters.objectId.trim()) params.set('objectId', filters.objectId.trim());
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return params;
}

/** Tham số gửi API — `pageSize`, không phải `limit`. */
export function auditQuery(page: number, limit: number, filters: Filters): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(limit) });
  for (const [key, value] of filterParams(filters)) params.set(key, value);
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
  const [open, setOpen] = useState<AuditRow | null>(null);

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
    placeholderData: keepPreviousData,
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
        /* Nút thật ở ô đầu: bấm cả dòng là tiện ích chuột, bàn phím / trình đọc màn hình mở
           chi tiết qua nút này (hàng có control bên trong nên `<tr>` không mang role=button). */
        cell: ({ row }) => (
          <button
            type="button"
            className="ghost sm mono audit-open"
            aria-label={t('audit.openDetail', { time: formatDateTime(row.original.createdAt) })}
            onClick={() => setOpen(row.original)}
          >
            {formatDateTime(row.original.createdAt)}
          </button>
        ),
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
        /* Nhãn tiếng Việt trước, mã ở dòng phụ: mã vẫn là thứ bộ lọc gửi đi và thứ người
           ta dán vào câu hỏi cho đội phát triển, nên không được giấu hẳn. */
        cell: ({ row }) => {
          const tone = auditActionTone(row.original.action);
          const label = auditActionLabel(row.original.action, t);
          return (
            <>
              {tone ? <span className={`badge ${tone}`}>{label}</span> : label}
              <span className="cell-sub mono">{row.original.action}</span>
            </>
          );
        },
      },
      {
        id: 'object',
        header: t('audit.object'),
        enableSorting: false,
        cell: ({ row }) => <ObjectCell row={row.original} />,
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

  /* Điện thoại: mỗi sự kiện hai dòng — "giờ · việc", rồi "ai → cái gì"; chạm là mở chi tiết. */
  const mobileCard: MobileCard<AuditRow> = {
    title: (row) => `${formatDateTime(row.createdAt)} · ${auditActionLabel(row.action, t)}`,
    badge: (row) => {
      const tone = auditActionTone(row.action);
      return tone === 'danger' ? <span className="badge danger">{t('audit.securityEvent')}</span> : null;
    },
    subtitle: (row) =>
      `${row.actorName ?? row.actor} → ${[objectTypeLabel(row.objectType, t), row.objectLabel]
        .filter(Boolean)
        .join(' · ') || '—'}`,
  };

  const exportUrl = `/api/v1/admin/audit/export?${filterParams(filters).toString()}`;

  return (
    <>
      <PageHeader
        title={t('audit.title')}
        subtitle={t('audit.subtitle')}
        actions={<ExportXlsxButton url={exportUrl} fileName="nhat-ky.xlsx" />}
      />

      <FilterBar
        search={url.searchInput}
        onSearchChange={url.setSearchInput}
        searchPlaceholder={t('audit.searchActor')}
        activeCount={url.activeCount}
        onClear={url.clearFilters}
      >
        <Select
          value={filters.action}
          ariaLabel={t('audit.action')}
          placeholder={t('audit.allActions')}
          searchable
          options={[
            { value: '', label: t('audit.allActions') },
            ...(actions.data ?? [])
              .map((action) => ({ value: action, label: auditActionLabel(action, t) }))
              .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
          ]}
          failed={actions.isError}
          onChange={(value) => url.setFilter('action', value)}
        />
        <Select
          value={filters.objectType}
          ariaLabel={t('audit.objectTypeFilter')}
          placeholder={t('audit.allObjectTypes')}
          options={[
            { value: '', label: t('audit.allObjectTypes') },
            ...Object.keys(OBJECT_TYPE_KEY)
              .map((type) => ({ value: type, label: objectTypeLabel(type, t) ?? type }))
              .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
          ]}
          onChange={(value) => url.setFilter('objectType', value)}
        />
        {/* Khoảng ngày là MỘT cụm hai ô cạnh nhau — mỗi ô một hàng rộng cả thanh là phí chỗ. */}
        <div className="filter-range" role="group" aria-label={t('audit.dateRange')}>
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
        </div>
        <input
          className="inp filter-object-id"
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
      </FilterBar>

      {list.isLoading ? (
        <Loading />
      ) : list.isError ? (
        <LoadError error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={url.isFiltered ? t('audit.emptyFiltered') : t('audit.empty')}
          hint={url.isFiltered ? t('audit.emptyFilteredHint') : t('audit.emptyHint')}
          action={
            url.isFiltered ? (
              <button type="button" className="btn" onClick={url.clearFilters}>
                {t('audit.clearFilters')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            emptyText={url.isFiltered ? t('audit.emptyFiltered') : t('audit.empty')}
            stackOnMobile
            mobileCard={mobileCard}
            /* Cả dòng bấm được (Enter/Space) để mở chi tiết — mũi tên 20px ở cột đầu là vùng bấm
               quá nhỏ, và dòng không có detail vẫn có thông tin để xem. */
            onRowClick={(row) => setOpen(row)}
            /* Sự kiện an ninh thất bại (gõ sai, bị từ chối, bị khóa) có vạch đỏ ở mép trái. */
            rowClassName={(row) => (auditActionTone(row.action) === 'danger' ? 'row-alert' : '')}
          />
          <Pagination
            page={page}
            limit={limit}
            onLimitChange={url.setLimit}
            total={list.data?.total ?? 0}
            onPageChange={url.setPage}
            compact
          />
          {list.data?.totalCapped ? <p className="muted">{t('audit.capped')}</p> : null}
        </>
      )}

      {open ? <AuditDetailDialog row={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/**
 * Chi tiết một dòng nhật ký: câu người đọc hiểu được, mốc đầy đủ, IP, bảng Trường · Trước · Sau
 * (khi `detail` có dạng đổi-từ-gì-sang-gì), và JSON gốc gập lại kèm nút chép — thứ để dán cho
 * đội phát triển.
 */
function AuditDetailDialog({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  const { t } = useTranslation();
  const { changes, rest } = detailChanges(row.detail);
  const shown = (value: unknown) =>
    value === null || value === undefined || value === ''
      ? t('history.blank')
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  const fieldLabel = (field: string) => t(`audit.field_${field}`, { defaultValue: field });
  const raw = row.detail === null || row.detail === undefined ? null : JSON.stringify(row.detail, null, 2);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={640}
      initialFocus="title"
      title={`${row.actorName ?? row.actor} · ${auditActionLabel(row.action, t)}`}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <dl className="audit-detail">
        <dt>{t('audit.time')}</dt>
        <dd>
          {formatDateTime(row.createdAt)} <span className="muted">{t('audit.timezoneNote')}</span>
        </dd>
        <dt>{t('audit.actor')}</dt>
        <dd>
          {row.actorName ?? row.actor}
          {row.actorName ? <span className="cell-sub">{row.actor}</span> : null}
        </dd>
        <dt>{t('audit.action')}</dt>
        <dd>
          {auditActionLabel(row.action, t)} <span className="cell-sub mono">{row.action}</span>
        </dd>
        <dt>{t('audit.object')}</dt>
        <dd>
          <ObjectCell row={row} />
        </dd>
        <dt>{t('audit.ip')}</dt>
        <dd className="mono">{orDash(row.ip)}</dd>
      </dl>

      {changes.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('audit.field')}</th>
                <th>{t('audit.before')}</th>
                <th>{t('audit.after')}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={change.field}>
                  <td>{fieldLabel(change.field)}</td>
                  <td>{shown(change.before)}</td>
                  <td>{shown(change.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {rest.length > 0 ? (
        <dl className="audit-detail">
          {rest.map(([key, value]) => (
            <div key={key || 'value'} className="audit-detail-row">
              <dt>{key ? fieldLabel(key) : t('audit.detail')}</dt>
              <dd>{shown(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {raw ? (
        <details className="audit-raw">
          <summary>{t('audit.rawJson')}</summary>
          <pre className="mono">{raw}</pre>
          <CopyButton value={raw} label={t('audit.copyJson')} />
        </details>
      ) : null}
    </Dialog>
  );
}

/**
 * "Tài khoản · nguyen.a@pmh.com.vn" kèm link tới hồ sơ, thay cho "user c91a9a41-…". UUID vẫn
 * còn — trong tooltip và nút chép — vì đó là thứ lọc "Mã đối tượng" nhận và thứ đối chiếu với DB.
 */
function ObjectCell({ row }: { row: AuditRow }) {
  const { t } = useTranslation();
  const type = objectTypeLabel(row.objectType, t);
  if (!row.objectId) return <>{orDash(type)}</>;
  const name = row.objectLabel ?? null;
  return (
    <>
      {type}
      {name ? (
        <>
          {' · '}
          {row.objectPath ? (
            <Link to={row.objectPath} title={row.objectId} aria-label={t('audit.openObject', { name })}>
              {name}
            </Link>
          ) : (
            <span title={row.objectId}>{name}</span>
          )}
        </>
      ) : null}
      <span className="cell-sub mono" title={row.objectId}>
        {name ? `${row.objectId.slice(0, 8)}…` : row.objectId}
        <CopyButton value={row.objectId} label={t('audit.copyObjectId')} />
      </span>
    </>
  );
}
