/** Luật mật khẩu tối thiểu (NFR-01) — dùng chung cho đổi mật khẩu và SA tạo/reset user. */
export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordCheck {
  ok: boolean;
  /** Lý do tiếng Việt để trả thẳng cho UI (convention Error: message tiếng Việt). */
  reason?: string;
}

export function checkPasswordStrength(plain: string): PasswordCheck {
  if (plain.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `Mật khẩu phải dài tối thiểu ${PASSWORD_MIN_LENGTH} ký tự.` };
  }
  if (plain.length > 200) {
    return { ok: false, reason: 'Mật khẩu quá dài (tối đa 200 ký tự).' };
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(plain)).length;
  if (classes < 3) {
    return {
      ok: false,
      reason: 'Mật khẩu cần ít nhất 3 trong 4 nhóm: chữ thường, chữ hoa, số, ký tự đặc biệt.',
    };
  }
  return { ok: true };
}
