import type { TFunction } from 'i18next';
import { orDash } from '@/lib/format';
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
  /** Họ tên người làm — API tra theo email; `null`/vắng thì màn hình rơi về email. */
  actorName?: string | null;
  /** Mã máy của `changes.deviceId` / `changes.previousDeviceId`, API tra sẵn. */
  deviceCode?: string | null;
  previousDeviceCode?: string | null;
}

/*
 * `suspect_dead` và `reclaimed` không còn là trạng thái sống (Q-02), nhưng `ip_history` là
 * chỉ-thêm và giữ vĩnh viễn: dòng cũ vẫn mang hai tên đó và vẫn phải đọc ra chữ. Đừng dọn.
 */
const STATUS_LABEL: Record<string, string> = {
  free: 'history.ip.stFree',
  assigned: 'history.ip.stAssigned',
  suspect_dead: 'history.ip.stSuspectDead',
  reclaimed: 'history.ip.stReclaimed',
};

/*
 * `t` đi vào bằng THAM SỐ, không phải `useTranslation()` bên trong: mấy hàm này là hàm THUẦN,
 * và đó là lý do chúng có bài kiểm bảng dữ liệu không cần dựng React.
 */
export function statusLabel(status: string | null | undefined, t: TFunction): string {
  /* `orDash` chứ KHÔNG phải một khóa i18n cho dấu gạch: dấu gạch là dấu câu, không phải ngôn
     ngữ, và `lib/format.ts` đã là nơi duy nhất quyết định nó trông thế nào. Khai thêm một
     khóa `noStatus: '—'` là dựng nguồn thứ hai cho cùng một ký tự. */
  if (!status) return orDash(null);
  const key = STATUS_LABEL[status];
  return key ? t(key) : status;
}

/**
 * Tên việc bằng tiếng Việt cho những hành động KHÔNG phải bước chuyển trạng thái.
 *
 * Bước chuyển đã tự mang tên tiếng Việt từ `transitionLabel` phía API ("Cấp IP", "Thu hồi"),
 * nhưng bốn cái còn lại thì API ghi thẳng khóa máy — nên bảng lịch sử đang xen kẽ "Thu hồi"
 * với "ip.voided". Ánh xạ ở web chứ không sửa dữ liệu đã ghi: `ip_history` là CHỈ-THÊM (AD-13),
 * mọi dòng cũ vẫn mang khóa máy và phải đọc được như dòng mới.
 *
 * Khóa lạ (migration sau, dữ liệu cũ) GIỮ NGUYÊN — hiện "ip.somethingNew" còn hơn hiện ô trống.
 */
export const ACTION_LABEL: Record<string, string> = {
  'ip.created': 'history.ip.actCreated',
  'ip.updated': 'history.ip.actUpdated',
  'ip.assigned': 'history.ip.actAssigned',
  'ip.voided': 'history.ip.actVoided',
  'ip.subnet_voided': 'history.ip.actSubnetVoided',
  'ip.restored': 'history.ip.actRestored',
  'ip.status_merged': 'history.ip.actStatusMerged',
};

export function actionLabel(action: string, t: TFunction): string {
  const key = ACTION_LABEL[action];
  return key ? t(key) : action;
}

/**
 * Dòng tắt-theo-dải ghi trước khi có mã `ip.subnet_voided` mang mã `ip.voided`. Không sửa được
 * dữ liệu cũ (AD-13), nên nhận ra nó ở đây — đọc nó thành "Xóa hồ sơ nhập nhầm" là nói sai về
 * một hồ sơ sống lại khi dải được dùng lại. Dấu hiệu là HÌNH DẠNG dòng, không phải câu chữ: lượt
 * tắt theo dải ghi cả `fromStatus` lẫn `toStatus`, lượt xóa lẻ chỉ ghi `fromStatus`.
 */
function effectiveAction(row: IpHistoryRow): string {
  if (row.action === 'ip.voided' && row.toStatus) return 'ip.subnet_voided';
  return row.action;
}

export function toIpHistoryEntries(rows: IpHistoryRow[], t: TFunction): HistoryEntry[] {
  return rows.map((row) => ({
    id: row.id,
    action: actionLabel(effectiveAction(row), t),
    detail: describe(row, t),
    actor: row.actor,
    actorName: row.actorName ?? undefined,
    at: row.createdAt,
  }));
}

/** "LT-E2E-01 (Nguyễn A)", "LT-E2E-01", hoặc "Nguyễn A" — mã máy đi trước, vì mắt dò theo mã. */
function ownerText(device: string | null, user: string | null): string | null {
  if (device && user) return `${device} (${user})`;
  return device ?? user;
}

function describe(row: IpHistoryRow, t: TFunction): string | undefined {
  const parts: string[] = [];
  const changes = row.changes ?? {};

  if (row.fromStatus && row.toStatus) {
    parts.push(`${statusLabel(row.fromStatus, t)} → ${statusLabel(row.toStatus, t)}`);
  } else if (row.toStatus) {
    parts.push(statusLabel(row.toStatus, t));
  }

  /**
   * Chủ CŨ chỉ hiện khi nó thật sự MẤT ĐI khỏi hồ sơ (thu hồi). Hiện ở mọi dòng thì mỗi bước
   * chuyển đều lặp lại "trước đây: …" và cái dòng duy nhất quan trọng chìm nghỉm giữa đám đó.
   */
  const previousUser = text(changes.previousUsedBy);
  const previousDevice = text(changes.previousDeviceId);
  const stillHasOwner = text(changes.usedBy) || text(changes.deviceId);
  if (!stillHasOwner && (previousUser || previousDevice)) {
    const who =
      ownerText(text(row.previousDeviceCode), previousUser) ?? t('history.ip.previousDevice');
    parts.push(t('history.ip.previous', { who }));
  }

  const newOwner = ownerText(text(row.deviceCode), text(changes.usedBy));
  if (newOwner && row.toStatus === 'assigned') {
    parts.push(t('history.ip.assignedTo', { who: newOwner }));
  }

  const address = text(changes.address);
  if (address) parts.push(address);

  const reason = text(changes.reason);
  if (reason) parts.push(t('history.ip.reasonIs', { reason }));

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
