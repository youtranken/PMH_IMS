export type IpStatus = 'free' | 'assigned' | 'suspect_dead' | 'reclaimed';

export interface SubnetRow {
  id: string;
  name: string;
  cidr: string;
  siteId: string | null;
  siteCode: string | null;
  /** Số VLAN 802.1Q (0029) — ở PMH người ta gọi dải theo VLAN chứ không theo CIDR. */
  vlan: number | null;
  /** Gateway của dải (0035) — câu hỏi đầu tiên khi khai IP tĩnh cho một cái máy. */
  gateway: string | null;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  total: number;
  used: number;
  free: number;
  percent: number;
  /**
   * Tổng số hồ sơ IP TỪNG thuộc dải này, kể cả đã thu hồi hoặc đã ẩn.
   *
   * Khác `used` (chỉ đếm IP đang chiếm chỗ). Màn hình dùng con số này để quyết định bày nút
   * **Xóa** (xóa hẳn — chỉ dải chưa từng dùng) hay nút **Vô hiệu hóa** (dải đã có lịch sử).
   */
  addressCount: number;
  /**
   * Dải đã vô hiệu hóa hay chưa — `null` là đang dùng (28/08/2026).
   *
   * Danh sách gọi kèm `?includeVoided=true` nên dải đã tắt VẪN nằm trong mảng này, gạch ngang
   * và xám đi. Trước đó API lọc thẳng ở SQL, nên vô hiệu hóa xong là dải biến mất — người
   * dùng đọc đúng cái đó là "đã bị xóa", trong khi mấy chục cái máy vẫn đang cắm IP tĩnh
   * thuộc dải ấy.
   */
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

export interface IpRow {
  id: string;
  subnetId: string;
  address: string;
  deviceId: string | null;
  deviceCode: string | null;
  deviceName: string | null;
  usedBy: string | null;
  assignedBy: string;
  assignedAt: string | null;
  status: IpStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** Hồ sơ đã ẨN hay chưa — `null` là đang hiển thị. Chỉ về khi màn xin `?includeVoided=true`. */
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

/** Một dòng trên màn dải: hoặc hồ sơ thật, hoặc một ô còn trống (không có hàng trong DB). */
export type SubnetSlot = ({ kind: 'record' } & IpRow) | { kind: 'free'; address: string };

export const STATUS_KEY: Record<IpStatus, string> = {
  free: 'ipam.statusFree',
  assigned: 'ipam.statusAssigned',
  suspect_dead: 'ipam.statusSuspectDead',
  reclaimed: 'ipam.statusReclaimed',
};

/**
 * "Nghi chết" là VÀNG chứ không đỏ: nó là một nghi ngờ chờ người đi kiểm, không phải một
 * sự cố. Để đỏ thì cả bảng đỏ rực và người ta thôi không nhìn màu nữa.
 */
export const STATUS_TONE: Record<IpStatus, string> = {
  free: 'muted',
  assigned: 'ok',
  suspect_dead: 'warn',
  reclaimed: 'muted',
};

/**
 * Đường đi hợp lệ của vòng đời — BẢN SAO ĐỌC của `api/src/modules/ipam/ip-lifecycle.ts`.
 *
 * Client giữ bản này chỉ để biết hiện nút nào; API vẫn là nơi phán. Lệch nhau thì tệ nhất là
 * hiện thừa một nút rồi bị API từ chối kèm lời giải thích — chứ không phải lọt một bước
 * chuyển sai. E2E kiểm cả hai đầu nên lệch là đỏ.
 */
export const NEXT_STATUSES: Record<IpStatus, IpStatus[]> = {
  free: ['assigned'],
  assigned: ['suspect_dead', 'reclaimed'],
  suspect_dead: ['assigned', 'reclaimed'],
  reclaimed: ['assigned'],
};

export const TRANSITION_LABEL: Record<string, string> = {
  'free->assigned': 'ipam.trAssign',
  'assigned->suspect_dead': 'ipam.trSuspect',
  'assigned->reclaimed': 'ipam.trReclaim',
  'suspect_dead->assigned': 'ipam.trStillUsed',
  'suspect_dead->reclaimed': 'ipam.trReclaim',
  'reclaimed->assigned': 'ipam.trReassign',
};
