import type { HistoryEntry } from '@/ui/history-panel';
import type { IspHistoryRow } from './isp-types';

/** Đổi `isp_line_history` thô thành dòng đọc được cho `HistoryPanel` dùng chung. */

const FIELD_LABEL: Record<string, string> = {
  code: 'mã đường',
  provider: 'nhà mạng',
  bandwidth: 'băng thông',
  wanIp: 'IP WAN',
  siteId: 'site',
  deviceId: 'thiết bị biên',
  hotline: 'hotline',
  contractNo: 'số hợp đồng',
  startDate: 'ngày bắt đầu',
  endDate: 'ngày hết hạn',
  note: 'ghi chú',
  status: 'trạng thái',
};

const ACTION_LABEL: Record<string, string> = {
  created: 'Tạo hồ sơ',
  updated: 'Sửa hồ sơ',
  renewed: 'Gia hạn hợp đồng',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Đang chạy',
  suspended: 'Tạm ngưng',
  terminated: 'Đã cắt',
};

export function toIspHistory(rows: IspHistoryRow[]): HistoryEntry[] {
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    actor: row.actor,
    action: ACTION_LABEL[row.action] ?? row.action,
    detail: describe(row.changes),
  }));
}

function describe(
  changes: Record<string, { before: unknown; after: unknown }> | null,
): string | null {
  if (!changes) return null;
  const parts = Object.entries(changes).map(([field, change]) => {
    const label = FIELD_LABEL[field] ?? field;
    // Id là uuid — hiện ra chỉ tổ rối, nói "đã đổi" là đủ dùng.
    if (field.endsWith('Id')) return `đổi ${label}`;
    return `${label}: ${display(field, change.before)} → ${display(field, change.after)}`;
  });
  return parts.length > 0 ? parts.join('; ') : null;
}

function display(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(trống)';
  if (field === 'status') return STATUS_LABEL[String(value)] ?? String(value);
  return String(value);
}
