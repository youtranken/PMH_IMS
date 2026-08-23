/**
 * Luật của một dòng sổ NAT (story 5.3, FR-017) — hàm THUẦN, không chạm DB.
 *
 * Mục tiêu của story viết rất rõ: auditor hỏi "port nào mở, vì sao, cho ai" là trả lời được
 * ngay. Nên `reason` và `usedBy` ở đây là BẮT BUỘC, không phải trường tùy chọn cho đẹp — một
 * dòng thiếu lý do là một dòng sáu tháng sau không ai dám đóng vì không biết nó phục vụ ai,
 * và cứ thế port nằm mở mãi.
 */

import { parseAddress } from './ip-rules';

const MIN_PORT = 1;
const MAX_PORT = 65535;
/** Mở rộng hơn ngần này thì phải nói ra — không chặn, nhưng người khai cần biết. */
const WIDE_RANGE = 1000;

export type PortRange =
  | { ok: true; from: number; to: number }
  | { ok: false; reason: 'format' | 'range' | 'reversed' };

/**
 * Nhận "8080" hoặc "8000-8010".
 *
 * Khoảng viết ngược báo RIÊNG (`reversed`) chứ không gộp vào "sai định dạng": người gõ biết
 * mình muốn gì, chỉ đảo hai đầu — nói đúng chỗ sai thì họ sửa trong hai giây, còn nói chung
 * chung thì họ ngồi soi lại cả dòng.
 */
export function parsePortRange(value: string): PortRange {
  const text = value.trim();
  const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(text);
  if (!match) return { ok: false, reason: 'format' };

  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  if (!inPortRange(from) || !inPortRange(to)) return { ok: false, reason: 'range' };
  if (from > to) return { ok: false, reason: 'reversed' };
  return { ok: true, from, to };
}

export function describePortRange(from: number, to: number): string {
  return from === to ? String(from) : `${from}-${to}`;
}

export interface NatRuleDraft {
  externalFrom: number;
  externalTo: number;
  internalIp: string;
  internalPort: number;
  usedBy: string;
  reason: string;
}

/**
 * Trả về danh sách lỗi tiếng Việt (rỗng = hợp lệ) thay vì ném ở lỗi đầu tiên: form NAT có
 * sáu ô, sửa từng lỗi một là sáu lần bấm Lưu.
 */
export function validateNatRule(draft: NatRuleDraft): string[] {
  const errors: string[] = [];

  if (!draft.usedBy.trim()) {
    errors.push('Ghi rõ rule này mở cho ai dùng — đó là câu auditor sẽ hỏi.');
  }
  if (!draft.reason.trim()) {
    errors.push('Ghi rõ vì sao phải mở port này. Không có lý do thì sau này không ai dám đóng.');
  }
  if (!parseAddress(draft.internalIp).ok) {
    errors.push('IP trong phải là địa chỉ IPv4 hợp lệ, vd 172.16.10.5.');
  }
  if (!inPortRange(draft.internalPort)) {
    errors.push(`Port trong phải từ ${MIN_PORT} đến ${MAX_PORT}.`);
  }
  if (draft.externalTo - draft.externalFrom + 1 > WIDE_RANGE) {
    errors.push(
      `Dải port ngoài này mở hơn ${WIDE_RANGE} cổng ra Internet. Nếu đúng ý thì cứ lưu, nhưng hãy chắc chắn.`,
    );
  }
  return errors;
}

function inPortRange(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}
