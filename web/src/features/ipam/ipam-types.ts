/** Hai trạng thái vòng đời (Q-02) — khớp `IP_LIFECYCLE_STATUSES` phía API. */
export type IpStatus = 'free' | 'assigned';

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
   * Dải đã vô hiệu hóa hay chưa — `null` là đang dùng.
   *
   * Danh sách gọi kèm `?includeVoided=true` nên dải đã tắt VẪN nằm trong mảng này, gạch ngang
   * và xám đi. Lọc thẳng ở SQL thì vô hiệu hóa xong là dải biến mất — người dùng đọc đúng cái
   * đó là "đã bị xóa", trong khi mấy chục cái máy vẫn đang cắm IP tĩnh thuộc dải ấy.
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
  /** Hồ sơ đã tắt hay chưa — `null` là đang dùng. Màn dải chỉ nhận hồ sơ tắt CÙNG dải đã ngừng dùng. */
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

/** Một kết quả tra IP xuyên dải (`GET ipam/addresses?search=`) — kèm dải chứa nó. */
export interface IpSearchHit extends IpRow {
  subnetCidr: string;
  subnetName: string;
  subnetVlan: number | null;
}

/** Một dòng trên màn dải: hoặc hồ sơ thật, hoặc một ô còn trống (không có hàng trong DB). */
export type SubnetSlot =
  /** `previousOwner`: chỉ hồ sơ Trống — chủ của lượt thu hồi gần nhất (API đọc từ lịch sử). */
  | ({ kind: 'record'; previousOwner?: string | null } & IpRow)
  | { kind: 'free'; address: string };

export const STATUS_KEY: Record<IpStatus, string> = {
  free: 'ipam.statusFree',
  assigned: 'ipam.statusAssigned',
};

export const STATUS_TONE: Record<IpStatus, string> = {
  free: 'muted',
  assigned: 'ok',
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
  assigned: ['free'],
};

export const TRANSITION_LABEL: Record<string, string> = {
  'free->assigned': 'ipam.trAssign',
  'assigned->free': 'ipam.trReclaim',
};
