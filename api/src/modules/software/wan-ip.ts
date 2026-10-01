/** Một nhóm 0–255, không số 0 đứng đầu ("010" dễ bị đọc theo hệ 8). */
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`);

/**
 * Trần số IP WAN một đường truyền. Đây là rào chống payload phình, không phải tham số nghiệp vụ
 * (nhà mạng cấp 1–3 IP), nên không đưa vào system_config. Form web dùng cùng số.
 */
export const MAX_WAN_IPS = 16;

export type WanIpsReason = 'invalid' | 'range' | 'too_many' | null;

/**
 * IP WAN của một đường truyền (Q-20): danh sách IPv4 ĐƠN, không nhận dải.
 *
 * Ô trống bị bỏ (form có hàng "Thêm IP" chưa điền), trùng thì giữ lần đầu, giữ thứ tự người
 * nhập — thứ tự là thứ lịch sử so, nên phải ổn định giữa hai lần lưu cùng một danh sách.
 * Cùng luật với form web (`isIpv4`); kiểm lại ở đây vì cột inet ném 22P02 = 500 trắng.
 */
export function wanIpsOf(raw: readonly string[]): {
  value: string[];
  reason: WanIpsReason;
  bad: string | null;
} {
  const value: string[] = [];
  for (const entry of raw) {
    const text = entry.trim();
    if (text === '') continue;
    if (text.includes('/')) return { value: [], reason: 'range', bad: text };
    if (!IPV4.test(text)) return { value: [], reason: 'invalid', bad: text };
    if (!value.includes(text)) value.push(text);
  }
  if (value.length > MAX_WAN_IPS) return { value: [], reason: 'too_many', bad: null };
  return { value, reason: null, bad: null };
}
