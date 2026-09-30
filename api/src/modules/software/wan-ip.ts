/** Một nhóm 0–255, không số 0 đứng đầu ("010" dễ bị đọc theo hệ 8). */
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const WAN_IP = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}(?:/(3[0-2]|[12]?\\d))?$`);

/**
 * IP WAN của đường truyền: một IPv4 hoặc một khối IPv4/prefix (Q-04, cột inet).
 *
 * Cùng luật với form web (`isIpv4OrCidr`), kiểm lại ở đây vì cột inet ném 22P02 = 500 trắng.
 * "/32" bị bỏ vì Postgres in inet /32 thành địa chỉ trần: giữ thì lịch sử ghi một lần "đổi"
 * mỗi lần lưu lại cùng giá trị.
 */
export function wanIpOf(raw: string): { value: string | null; valid: boolean } {
  const text = raw.trim();
  if (text === '') return { value: null, valid: true };
  const match = WAN_IP.exec(text);
  if (!match) return { value: null, valid: false };
  return { value: match[1] === '32' ? text.slice(0, -3) : text, valid: true };
}
