/**
 * Luật mật khẩu phía web — cùng luật với `api/src/modules/auth/password-policy.ts` (NFR-01):
 * tối thiểu 12 ký tự và có ít nhất 3 trong 4 nhóm. Chỉ để báo SỚM trên màn (checklist tick
 * dần khi gõ); API vẫn là nơi phán, nên lệch một chút thì người dùng nhận câu lỗi của API chứ
 * không lọt được mật khẩu yếu.
 *
 * Nhóm "ký tự đặc biệt" là mọi thứ ngoài a-z, A-Z, 0-9 — kể cả chữ có dấu — đúng như regex
 * của API; checklist nói khác API thì người dùng thấy tick xanh rồi vẫn bị từ chối.
 */
export const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MIN_GROUPS = 3;

export interface PasswordRules {
  length: number;
  lengthOk: boolean;
  groups: { lower: boolean; upper: boolean; digit: boolean; special: boolean };
  groupCount: number;
  groupsOk: boolean;
}

/** `reason`: `null` = đạt; nếu không, luật đầu tiên chưa đạt. Một hình dạng (tsconfig không strict). */
export function checkPasswordRules(password: string): {
  value: PasswordRules;
  reason: 'empty' | 'short' | 'groups' | null;
} {
  const groups = {
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    digit: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
  const groupCount = Object.values(groups).filter(Boolean).length;
  const value: PasswordRules = {
    length: password.length,
    lengthOk: password.length >= PASSWORD_MIN_LENGTH,
    groups,
    groupCount,
    groupsOk: groupCount >= PASSWORD_MIN_GROUPS,
  };
  const reason =
    password.length === 0 ? 'empty' : !value.lengthOk ? 'short' : !value.groupsOk ? 'groups' : null;
  return { value, reason };
}
