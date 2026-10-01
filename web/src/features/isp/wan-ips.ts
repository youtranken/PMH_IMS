import { parseIpv4 } from '@/lib/ipv4';

/** Cùng trần với API (`MAX_WAN_IPS` ở api/src/modules/software/wan-ip.ts). */
export const MAX_WAN_IPS = 16;

export type WanIpIssue = 'range' | 'invalid' | 'duplicate' | null;

/**
 * Lỗi của từng dòng IP WAN (Q-20): mỗi dòng một IPv4 ĐƠN. Nhà mạng cấp từng IP, nên chữ có
 * "/" bị báo riêng là dải — câu "không phải IPv4" với một dải đúng cú pháp làm người nhập khó
 * hiểu sai ở đâu. Dòng trống không lỗi: đó là hàng "Thêm IP" chưa điền, gửi đi sẽ bị bỏ.
 * Trùng thì báo ở lần lặp sau, dòng đầu giữ nguyên.
 */
export function wanIpIssues(entries: readonly string[]): WanIpIssue[] {
  const seen = new Set<string>();
  return entries.map((entry) => {
    const text = entry.trim();
    if (text === '') return null;
    if (text.includes('/')) return 'range';
    if (parseIpv4(text) === null) return 'invalid';
    if (seen.has(text)) return 'duplicate';
    seen.add(text);
    return null;
  });
}

/** Thứ gửi lên API: bỏ dòng trống, cắt khoảng trắng, giữ thứ tự người nhập. */
export function wanIpsPayload(entries: readonly string[]): string[] {
  return entries.map((entry) => entry.trim()).filter((entry) => entry !== '');
}
