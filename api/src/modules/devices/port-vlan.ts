/**
 * VLAN của một cổng: số 1–4094 (dải 802.1Q, như `subnet.vlan`) hoặc "trunk" (Q-16).
 * Cùng luật với CHECK `device_port_vlan_check`; kiểm ở đây để trả 400 có câu tiếng Việt
 * thay vì để ràng buộc DB ném 500.
 */
export function portVlanOf(raw: string): { value: string | null; valid: boolean } {
  const text = raw.trim().toLowerCase();
  if (text === '') return { value: null, valid: true };
  if (text === 'trunk') return { value: text, valid: true };
  if (/^[1-9]\d{0,3}$/.test(text) && Number(text) <= 4094) return { value: text, valid: true };
  return { value: null, valid: false };
}
