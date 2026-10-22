import type { ExportColumn } from '../../common/excel/excel-export.service';
import { foldSearch } from '../../common/search-fold';
import { dateTimeInTz } from '../../common/today';
import type { IncidentRecord } from './iso-incident.service';
import type { IncidentKind, IncidentSeverity, IncidentStatus } from './iso-rules';

/* Nhãn tiếng Anh như trên giấy 0206 và cột Loại / Trạng thái của màn danh sách. */
const KIND_LABEL: Record<IncidentKind, string> = {
  backup: 'Backup',
  server: 'Server',
  network: 'Network',
  database: 'Database',
  other: 'Other',
};
const SEVERITY_LABEL: Record<IncidentSeverity, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const STATUS_LABEL: Record<IncidentStatus, string> = {
  temporary_fix: 'Temporary Fix',
  resolved: 'Resolved',
  in_progress: 'In Progress',
};

/**
 * Ô tìm của danh sách 0206 lọc tại chỗ trên trình duyệt; file xuất phải ra đúng những dòng đó
 * (FR-028), nên dùng cùng trường: số phiếu, mô tả, người lập, nhãn ô gắn kèm — gấp dấu như màn.
 */
export function matchesIncidentSearch(row: IncidentRecord, q: string): boolean {
  const needle = foldSearch(q.trim());
  if (!needle) return true;
  return foldSearch([row.code, row.description, row.createdByName, ...row.cells.map((c) => c.label)].join(' ')).includes(
    needle,
  );
}

function sourceText(row: IncidentRecord): string {
  if (row.cells.length === 0) return 'Lập trực tiếp';
  return row.cells.map((c) => `${c.form} · ${c.label}`).join('; ');
}

export function incidentExportColumns(timeZone: string): ExportColumn<IncidentRecord>[] {
  const at = (iso: string | null) => (iso ? dateTimeInTz(new Date(iso), timeZone) : '');
  return [
    { header: 'Số phiếu', width: 16, value: (r) => r.code },
    { header: 'Kỳ', width: 9, value: (r) => `${String(r.month).padStart(2, '0')}/${r.year}` },
    { header: 'Nguồn', width: 32, value: sourceText },
    { header: 'Loại', width: 11, value: (r) => KIND_LABEL[r.kind] },
    { header: 'Mức độ', width: 9, value: (r) => SEVERITY_LABEL[r.severity] },
    { header: 'Phát hiện', width: 17, value: (r) => at(r.detectedAt) },
    { header: 'Xử lý xong', width: 17, value: (r) => at(r.resolvedAt) },
    { header: 'Trạng thái', width: 14, value: (r) => STATUS_LABEL[r.status] },
    { header: 'Mô tả', width: 40, value: (r) => r.description },
    { header: 'Khắc phục', width: 40, value: (r) => r.correctiveAction },
    { header: 'Người lập', width: 24, value: (r) => r.createdByName },
    { header: 'Bản ký', width: 10, value: (r) => (r.signedCurrent ? 'Đã có' : 'Chưa có') },
  ];
}
