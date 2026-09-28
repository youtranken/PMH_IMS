/**
 * Phép tính IPv4 phía web — tra "IP này thuộc dải nào" mà không phải hỏi lại API.
 *
 * Màn Địa chỉ IP và hộp Tìm nhanh cùng cần nó: gõ 10.77.1.53 thì phải biết mở dải nào, kể cả
 * khi địa chỉ ấy còn TRỐNG (chưa có hồ sơ nên API tìm hồ sơ không trả gì).
 */

/** Địa chỉ dạng số 32 bit, hoặc `null` nếu không phải IPv4 viết chuẩn (không số 0 đứng đầu). */
export function parseIpv4(text: string): number | null {
  const parts = text.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // Cùng luật với API (`ip-rules.ts`): "010" dễ bị hiểu là bát phân, nên không nhận.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/**
 * Câu gõ có DÁNG địa chỉ IP/CIDR không (kể cả gõ dở "10.77.1.") — để đưa nhóm IP lên đầu.
 * Cần ít nhất một dấu chấm: gõ "10" là mã máy cũng được, chưa đủ để đoán.
 */
export function looksLikeIp(text: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){1,3}\.?(\/\d{1,2})?$/.test(text.trim());
}

function parseCidr(cidr: string): { base: number; prefix: number } | null {
  const [address, bits] = cidr.split('/');
  const base = parseIpv4(address ?? '');
  const prefix = Number(bits);
  if (base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  return { base, prefix };
}

/** Dải có chứa địa chỉ này không. Chia lấy phần nguyên thay vì dịch bit: `>>` của JS là 32 bit CÓ dấu. */
export function cidrContains(cidr: string, ip: string): boolean {
  const range = parseCidr(cidr);
  const value = parseIpv4(ip);
  if (!range || value === null) return false;
  const size = 2 ** (32 - range.prefix);
  return Math.floor(value / size) === Math.floor(range.base / size);
}

/** Chuỗi chấm-thập-phân từ số 32 bit. */
function formatIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

/** Mask chấm-thập-phân của một prefix, vd 24 → 255.255.255.0. */
function maskOfPrefix(prefix: number): string {
  return formatIpv4(2 ** 32 - 2 ** (32 - prefix));
}

/**
 * Dải rộng nhất API nhận — cùng `MIN_PREFIX` của `ip-rules.ts`. Cả dải phải về trong một lượt
 * gọi và vẽ được thành từng dòng; nói ngay khi gõ còn hơn để server từ chối lúc bấm Lưu.
 */
export const MIN_SUBNET_PREFIX = 24;

export interface CidrPreview {
  cidr: string;
  hosts: number;
  first: string;
  last: string;
  mask: string;
}

/**
 * Xem trước một dải đang gõ: dạng chuẩn API sẽ quy về, số host, host đầu–cuối và mask.
 * Một hình dạng `{ value, reason }` (không union `ok`) vì `tsconfig.app.json` không bật strict.
 * Chuỗi rỗng trả cả hai `null`: chưa gõ gì thì chưa có gì để báo.
 */
export function previewCidr(text: string): {
  value: CidrPreview | null;
  reason: 'format' | 'tooWide' | null;
} {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, reason: null };
  if (!/^[^/]+\/\d{1,2}$/.test(trimmed)) return { value: null, reason: 'format' };
  const range = parseCidr(trimmed);
  if (!range) return { value: null, reason: 'format' };
  if (range.prefix < MIN_SUBNET_PREFIX) return { value: null, reason: 'tooWide' };
  const size = 2 ** (32 - range.prefix);
  const network = Math.floor(range.base / size) * size;
  // /31 và /32 không có địa chỉ mạng/quảng bá để trừ ra — cùng luật `subnetUsage` phía API.
  const reserved = range.prefix >= 31 ? 0 : 1;
  return {
    value: {
      cidr: `${formatIpv4(network)}/${range.prefix}`,
      hosts: size - reserved * 2,
      first: formatIpv4(network + reserved),
      last: formatIpv4(network + size - 1 - reserved),
      mask: maskOfPrefix(range.prefix),
    },
    reason: null,
  };
}

/** Hai dải có chung địa chỉ nào không — dải nào to hơn thì chứa trọn dải kia. */
export function cidrOverlaps(a: string, b: string): boolean {
  const left = parseCidr(a);
  const right = parseCidr(b);
  if (!left || !right) return false;
  const size = 2 ** (32 - Math.min(left.prefix, right.prefix));
  return Math.floor(left.base / size) === Math.floor(right.base / size);
}

/** Mask của một dải đã lưu, hoặc `null` nếu chuỗi không phải CIDR. */
export function maskOfCidr(cidr: string): string | null {
  const range = parseCidr(cidr);
  return range ? maskOfPrefix(range.prefix) : null;
}

/** Một IPv4, hoặc một khối IPv4/prefix — ô "IP WAN" nhận cả hai. */
export function isIpv4OrCidr(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes('/')) return parseIpv4(trimmed) !== null;
  return /^[^/]+\/\d{1,2}$/.test(trimmed) && parseCidr(trimmed) !== null;
}

/** Dải chứa địa chỉ; hai dải lồng nhau thì dải HẸP nhất thắng — đó là dải thật sự cấp nó. */
export function subnetOf<T extends { cidr: string }>(ip: string, subnets: readonly T[]): T | null {
  let best: T | null = null;
  let bestPrefix = -1;
  for (const subnet of subnets) {
    const range = parseCidr(subnet.cidr);
    if (range && range.prefix > bestPrefix && cidrContains(subnet.cidr, ip)) {
      best = subnet;
      bestPrefix = range.prefix;
    }
  }
  return best;
}
