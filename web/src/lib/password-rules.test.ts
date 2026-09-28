import { describe, expect, it } from 'vitest';
import { PASSWORD_MIN_LENGTH, checkPasswordRules } from './password-rules';

/**
 * Bản web của `api/src/modules/auth/password-policy.ts`: ≥12 ký tự và ≥3 trong 4 nhóm. API vẫn
 * là nơi phán; bảng này chỉ canh rằng checklist trên màn nói ĐÚNG luật đó, không nói luật khác.
 */
describe('checkPasswordRules', () => {
  const cases: [string, string, number, number, string | null][] = [
    // [mô tả, mật khẩu, độ dài, số nhóm, reason]
    ['trống', '', 0, 0, 'empty'],
    ['ngắn dù đủ 4 nhóm', 'Ab1!', 4, 4, 'short'],
    ['đủ dài, chỉ chữ thường', 'aaaaaaaaaaaa', 12, 1, 'groups'],
    ['đủ dài, 2 nhóm', 'aaaaaaAAAAAA', 12, 2, 'groups'],
    ['đủ dài, thường + hoa + số', 'aaaaAAAA1111', 12, 3, null],
    ['đủ dài, thường + số + ký tự đặc biệt', 'matkhau-2026', 12, 3, null],
    ['đủ 4 nhóm', 'Mat-Khau-2026', 13, 4, null],
    ['11 ký tự, 4 nhóm — vẫn ngắn', 'Mat-Khau-20', 11, 4, 'short'],
    ['chữ có dấu tính là ký tự đặc biệt như API', 'mậtkhẩuhaihai', 13, 2, 'groups'],
  ];

  it.each(cases)('%s', (_label, password, length, groups, reason) => {
    const result = checkPasswordRules(password);
    expect(result.value.length).toBe(length);
    expect(result.value.groupCount).toBe(groups);
    expect(result.reason).toBe(reason);
    expect(result.value.lengthOk).toBe(length >= PASSWORD_MIN_LENGTH);
    expect(result.value.groupsOk).toBe(groups >= 3);
  });

  it('báo từng nhóm riêng để checklist tick đúng dòng', () => {
    expect(checkPasswordRules('a1').value.groups).toEqual({
      lower: true,
      upper: false,
      digit: true,
      special: false,
    });
  });
});
