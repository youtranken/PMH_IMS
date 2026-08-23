/**
 * Số học IPv4 — hàm THUẦN, không chạm DB (story 5.1, FR-018/FR-020).
 *
 * Tách ra vì đây là chỗ sai thầm lặng nhất của cả epic: sai một bit là cấp trùng IP, và
 * chuyện đó chỉ lộ ra ở ngoài mạng — hai máy cùng IP, người dùng báo "mạng chập chờn", còn
 * hệ thống thì vẫn nói mọi thứ ổn. Kiểm bằng bảng dữ liệu rẻ hơn nhiều so với đi dò cáp.
 *
 * v1 CHỈ IPv4: PMH chạy 172.16.x/24 trên LAN, chưa có IPv6. Nhận IPv6 nửa vời còn tệ hơn
 * từ chối thẳng — người ta khai vào rồi tưởng hệ thống quản được.
 */

/** Rộng hơn /8 (16 triệu địa chỉ) thì gần như chắc chắn là gõ nhầm, không phải LAN của PMH. */
const MIN_PREFIX = 8;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Đúng 4 nhóm 0–255, KHÔNG cho số 0 đứng đầu (tránh bị đọc theo hệ 8). */
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseAddress(value: string): ParseResult<string> {
  const text = value.trim();
  const match = IPV4.exec(text);
  if (!match) return { ok: false, reason: 'not_ipv4' };
  for (let i = 1; i <= 4; i += 1) {
    const part = match[i];
    if (part.length > 1 && part.startsWith('0')) return { ok: false, reason: 'leading_zero' };
    if (Number(part) > 255) return { ok: false, reason: 'octet_range' };
  }
  return { ok: true, value: text };
}

export function addressToLong(address: string): number {
  const [a, b, c, d] = address.split('.').map(Number);
  // `>>> 0`: dịch bit trong JS làm việc trên số CÓ DẤU 32 bit, nên 255.x.x.x ra số âm.
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

export function longToAddress(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

export interface Subnet {
  /** Dạng chuẩn `<địa chỉ mạng>/<prefix>`. */
  cidr: string;
  network: number;
  prefix: number;
}

/**
 * Chuẩn hóa dải người dùng gõ vào.
 *
 * Quy về ĐỊA CHỈ MẠNG: người ta hay gõ IP máy mình kèm /24 (`172.16.10.37/24`). Lưu nguyên
 * như vậy thì hai người khai cùng một dải ra hai bản ghi khác nhau, và ràng buộc "không
 * trùng dải" mất tác dụng ngay từ đầu.
 */
export function normalizeSubnet(
  value: string,
): { ok: true; cidr: string; network: number; prefix: number } | { ok: false; reason: string } {
  const text = value.trim();
  const slash = text.lastIndexOf('/');
  if (slash < 0) return { ok: false, reason: 'missing_prefix' };

  const address = parseAddress(text.slice(0, slash));
  if (!address.ok) return { ok: false, reason: address.reason };

  const prefixText = text.slice(slash + 1);
  if (!/^\d{1,2}$/.test(prefixText)) return { ok: false, reason: 'bad_prefix' };
  const prefix = Number(prefixText);
  if (prefix > 32) return { ok: false, reason: 'bad_prefix' };
  if (prefix < MIN_PREFIX) return { ok: false, reason: 'too_wide' };

  const network = maskOf(prefix) === 0 ? 0 : (addressToLong(address.value) & maskOf(prefix)) >>> 0;
  return { ok: true, cidr: `${longToAddress(network)}/${prefix}`, network, prefix };
}

function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function isHostInSubnet(address: string, cidr: string): boolean {
  const host = parseAddress(address);
  const subnet = normalizeSubnet(cidr);
  if (!host.ok || !subnet.ok) return false;
  return ((addressToLong(host.value) & maskOf(subnet.prefix)) >>> 0) === subnet.network;
}

/**
 * Số địa chỉ CẤP ĐƯỢC — đã trừ địa chỉ mạng và địa chỉ quảng bá.
 *
 * Hai ngoại lệ có thật, không phải chuyện lý thuyết:
 *  - /31: link point-to-point giữa hai router (RFC 3021), cả hai địa chỉ đều dùng được.
 *  - /32: đúng một máy, không có gì để trừ.
 */
export function usableHostCount(cidr: string): number {
  const subnet = normalizeSubnet(cidr);
  if (!subnet.ok) return 0;
  const size = 2 ** (32 - subnet.prefix);
  if (subnet.prefix >= 31) return size;
  return size - 2;
}

/** Danh sách địa chỉ cấp được, theo thứ tự tăng dần. */
export function enumerateHosts(cidr: string): string[] {
  const subnet = normalizeSubnet(cidr);
  if (!subnet.ok) return [];
  const size = 2 ** (32 - subnet.prefix);
  const first = subnet.prefix >= 31 ? subnet.network : subnet.network + 1;
  const count = subnet.prefix >= 31 ? size : size - 2;
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(longToAddress(first + i));
  return out;
}

export interface SubnetUsage {
  total: number;
  used: number;
  free: number;
  percent: number;
}

/**
 * FR-020: mức sử dụng subnet.
 *
 * Kẹp trong 0–100 kể cả khi dữ liệu lệch (đếm nhiều hơn số cấp được — vd subnet bị thu hẹp
 * sau khi đã cấp IP): thanh tiến trình 103% tràn ra ngoài khung và người đọc mất lòng tin
 * vào cả trang, trong khi con số đúng thì chẳng ai đọc được gì thêm.
 */
export function subnetUsage(cidr: string, usedCount: number): SubnetUsage {
  const total = usableHostCount(cidr);
  const free = Math.max(0, total - usedCount);
  const percent = total === 0 ? 0 : Math.min(100, Math.round((usedCount / total) * 100));
  return { total, used: usedCount, free, percent };
}
