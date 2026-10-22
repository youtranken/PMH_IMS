/**
 * Luật mã hồ sơ (PW-A12, Q-33): chỉ A–Z 0–9 - _ . / — không dấu, không khoảng trắng. Cùng mẫu
 * với `api/src/common/record-code.ts`; đổi một bên thì đổi cả hai.
 */
const RECORD_CODE_PATTERN = /^[A-Z0-9_./-]+$/;

/**
 * `'format'` khi mã sai luật. Ô trống để luật "bắt buộc" của form báo. `original` là mã đang
 * lưu (form Sửa): giữ đúng mã đó thì không báo — mã khai trước khi có luật không chặn việc sửa
 * các ô khác.
 */
export function recordCodeProblem(code: string, original = ''): 'format' | null {
  const trimmed = code.trim();
  if (!trimmed || (original && trimmed === original)) return null;
  return RECORD_CODE_PATTERN.test(trimmed) ? null : 'format';
}
