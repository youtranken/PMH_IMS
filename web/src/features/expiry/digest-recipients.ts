import { isEmail } from '@/lib/email';

/** Số gợi ý tối đa dưới ô Người nhận — nhiều hơn là thành một danh bạ phải đọc. */
const MAX_SUGGESTIONS = 6;

/** Ô Người nhận (tự do: phẩy / chấm phẩy / xuống dòng) → từng email kèm cờ đúng dạng. */
export function parseRecipients(text: string): { email: string; valid: boolean }[] {
  return text
    .split(/[,;\n]/)
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email, valid: isEmail(email) }));
}

/**
 * Gợi ý người nhận: email đã dùng ở các luật khác (dùng nhiều trước) cộng email của chính người
 * đang soạn, bỏ những email đã có trong ô. Không lấy từ danh sách tài khoản: người nhận thư báo
 * cáo thường là hộp thư chung (it@, ketoan@) chứ không phải tài khoản IMS.
 */
export function recipientSuggestions(
  rules: { recipients: string[] }[],
  meEmail: string,
  current: string,
): string[] {
  const taken = new Set(parseRecipients(current).map((item) => item.email.toLowerCase()));
  const uses = new Map<string, number>();
  for (const rule of rules) {
    for (const email of rule.recipients) {
      const key = email.toLowerCase();
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const me = meEmail.toLowerCase();
  if (me && !uses.has(me)) uses.set(me, 0);
  return [...uses.entries()]
    .filter(([email]) => !taken.has(email))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_SUGGESTIONS)
    .map(([email]) => email);
}
