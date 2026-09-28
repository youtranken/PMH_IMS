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
