import type { TFunction } from 'i18next';
import type { HistoryEntry } from '@/ui/history-panel';
import { describeFieldChanges } from '@/ui/history-changes';

/** Một dòng `catalog_history` như `GET /catalog/:entity/:id/history` trả về. */
export interface CatalogHistoryRow {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  actor: string;
  changes: Record<string, unknown> | null;
  createdAt: string;
}

const FIELD_LABEL: Record<string, string> = {
  code: 'history.catalog.fCode',
  name: 'history.fName',
  address: 'history.catalog.fAddress',
  siteId: 'history.fSiteId',
  description: 'history.catalog.fDescription',
  uHeight: 'history.catalog.fUHeight',
  hasPortMap: 'history.catalog.fHasPortMap',
  supplies: 'history.catalog.fSupplies',
  phone: 'history.catalog.fPhone',
  contact: 'history.catalog.fContact',
  hotline: 'history.catalog.fHotline',
  protocol: 'history.catalog.fProtocol',
  portFrom: 'history.catalog.fPortFrom',
  portTo: 'history.catalog.fPortTo',
  active: 'history.fStatus',
};

export const ACTION_LABEL: Record<string, string> = {
  created: 'history.catalog.actCreated',
  updated: 'history.catalog.actUpdated',
  activated: 'history.catalog.actActivated',
  deactivated: 'history.catalog.actDeactivated',
  deleted: 'history.catalog.actDeleted',
  imported: 'history.catalog.actImported',
  'imported-update': 'history.catalog.actImportedUpdate',
};

/*
 * `t` đi vào bằng tham số để hàm còn là hàm thuần (bài kiểm bảng dữ liệu, không dựng React).
 */
export function toCatalogHistory(rows: CatalogHistoryRow[], t: TFunction): HistoryEntry[] {
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    actor: row.actor,
    action: ACTION_LABEL[row.action] ? t(ACTION_LABEL[row.action]) : row.action,
    detail: describe(row, t),
  }));
}

/**
 * Sổ danh mục KHÔNG lưu `{trường: {before, after}}` như các sổ khác: lượt sửa lưu hai khối phẳng
 * `{before: {chỉ trường đã đổi}, after: {cả hồ sơ}}`, lượt tạo/nhập lưu nguyên hồ sơ. Đổi về
 * `FieldChanges` ở đây để dùng lại cách đọc chung, thay vì viết cách đọc thứ hai.
 *
 * Lượt tạo không in lại cả hồ sơ: người mở sổ đang nhìn chính hồ sơ đó, dòng "Tạo mục · ai ·
 * lúc nào" mới là thứ họ cần.
 */
function describe(row: CatalogHistoryRow, t: TFunction): string | null {
  const changes = row.changes;
  if (!changes || row.action !== 'updated') return null;
  const before = (changes.before ?? {}) as Record<string, unknown>;
  const after = (changes.after ?? {}) as Record<string, unknown>;
  const fields: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of Object.keys(before)) {
    fields[field] = { before: before[field], after: after[field] };
  }
  if (Object.keys(fields).length === 0) return null;
  return describeFieldChanges(fields, t, {
    label: (field) => (FIELD_LABEL[field] ? t(FIELD_LABEL[field]) : field),
    display: (_field, value) =>
      typeof value === 'boolean' ? t(value ? 'common.yes' : 'common.no') : undefined,
  });
}
