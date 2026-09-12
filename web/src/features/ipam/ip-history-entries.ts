import type { HistoryEntry } from '@/ui/history-panel';

/**
 * Đổi bản ghi `ip_history` thô thành dòng người đọc được (story 5.2).
 *
 * Mục tiêu của AC rất cụ thể: mở trang một IP và đọc được **"IP này từng là máy in kế toán"**.
 * Nên chỗ quan trọng nhất ở đây là dòng THU HỒI — nó phải nói ra chủ CŨ, vì sau khi thu hồi
 * thì bản thân hồ sơ IP đã không còn giữ thông tin đó nữa.
 *
 * Tách khỏi component để test được bằng bảng dữ liệu, không cần render.
 */

export interface IpHistoryRow {
  id: string;
  action: string;
  actor: string;
  fromStatus: string | null;
  toStatus: string | null;
  changes: Record<string, unknown> | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  free: 'Trống',
  assigned: 'Đang cấp',
  suspect_dead: 'Nghi chết',
  reclaimed: 'Đã thu hồi',
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return STATUS_LABEL[status] ?? status;
}

/**
 * Tên việc bằng tiếng Việt cho những hành động KHÔNG phải bước chuyển trạng thái.
 *
 * Bước chuyển đã tự mang tên tiếng Việt từ `transitionLabel` phía API ("Thu hồi", "Cấp lại"),
 * nhưng bốn cái còn lại thì API ghi thẳng khóa máy — nên bảng lịch sử đang xen kẽ "Thu hồi"
 * với "ip.voided". Ánh xạ ở web chứ không sửa dữ liệu đã ghi: `ip_history` là CHỈ-THÊM (AD-13),
 * mọi dòng cũ vẫn mang khóa máy và phải đọc được như dòng mới.
 *
 * Khóa lạ (migration sau, dữ liệu cũ) GIỮ NGUYÊN — hiện "ip.somethingNew" còn hơn hiện ô trống.
 */
export const ACTION_LABEL: Record<string, string> = {
  'ip.created': 'Tạo hồ sơ',
  'ip.updated': 'Sửa hồ sơ',
  'ip.assigned': 'Gán chủ',
  'ip.voided': 'Xóa hồ sơ',
  'ip.restored': 'Bật lại',
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

export function toIpHistoryEntries(rows: IpHistoryRow[]): HistoryEntry[] {
  return rows.map((row) => ({
    id: row.id,
    action: actionLabel(row.action),
    detail: describe(row),
    actor: row.actor,
    at: row.createdAt,
  }));
}

function describe(row: IpHistoryRow): string | undefined {
  const parts: string[] = [];
  const changes = row.changes ?? {};

  if (row.fromStatus && row.toStatus) {
    parts.push(`${statusLabel(row.fromStatus)} → ${statusLabel(row.toStatus)}`);
  } else if (row.toStatus) {
    parts.push(statusLabel(row.toStatus));
  }

  /**
   * Chủ CŨ chỉ hiện khi nó thật sự MẤT ĐI khỏi hồ sơ (thu hồi). Hiện ở mọi dòng thì mỗi bước
   * chuyển đều lặp lại "trước đây: …" và cái dòng duy nhất quan trọng chìm nghỉm giữa đám đó.
   */
  const previousUser = text(changes.previousUsedBy);
  const previousDevice = text(changes.previousDeviceId);
  const stillHasOwner = text(changes.usedBy) || text(changes.deviceId);
  if (!stillHasOwner && (previousUser || previousDevice)) {
    parts.push(`trước đó: ${previousUser ?? 'thiết bị đã gắn'}`);
  }

  const newUser = text(changes.usedBy);
  if (newUser && row.toStatus === 'assigned') parts.push(`cấp cho: ${newUser}`);

  const address = text(changes.address);
  if (address) parts.push(address);

  const reason = text(changes.reason);
  if (reason) parts.push(`lý do: ${reason}`);

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
