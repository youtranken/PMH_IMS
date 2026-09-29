import { PASSWORD_MIN_LENGTH, checkPasswordStrength } from './password-policy';

/**
 * Luật mật khẩu (NFR-01) — hàm thuần, đúng loại phải test bằng bảng dữ liệu theo CLAUDE.md.
 *
 * Một e2e chốt chung chung "mật khẩu yếu bị từ chối" không phân biệt được từ chối vì ĐỘ DÀI
 * hay vì SỐ NHÓM KÝ TỰ, nên đổi ngưỡng nào cũng không làm đỏ. Bảng dưới đây chốt từng BIÊN một.
 */
describe('checkPasswordStrength', () => {
  describe('biên độ dài', () => {
    it.each([
      ['', 'rỗng'],
      ['a', '1 ký tự'],
      ['Ab1!45678901'.slice(0, PASSWORD_MIN_LENGTH - 1), `${PASSWORD_MIN_LENGTH - 1} ký tự — dưới ngưỡng đúng 1`],
    ])('từ chối %j (%s)', (plain) => {
      const result = checkPasswordStrength(plain);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain(String(PASSWORD_MIN_LENGTH));
    });

    it(`chấp nhận đúng ${PASSWORD_MIN_LENGTH} ký tự khi đủ 3 nhóm`, () => {
      const plain = 'Abcdef123456'; // 12 ký tự: thường + hoa + số = 3 nhóm
      expect(plain).toHaveLength(PASSWORD_MIN_LENGTH);
      expect(checkPasswordStrength(plain)).toEqual({ ok: true });
    });

    it('từ chối 201 ký tự nhưng chấp nhận đúng 200', () => {
      const base = 'Aa1!';
      const at200 = base.repeat(50);
      expect(at200).toHaveLength(200);
      expect(checkPasswordStrength(at200).ok).toBe(true);

      const at201 = at200 + 'x';
      const result = checkPasswordStrength(at201);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('quá dài');
    });
  });

  describe('biên số nhóm ký tự (cần ít nhất 3 trong 4)', () => {
    it.each([
      ['abcdefghijklm', 1, 'chỉ chữ thường'],
      ['ABCDEFGHIJKLM', 1, 'chỉ chữ hoa'],
      ['1234567890123', 1, 'chỉ số'],
      ['!@#$%^&*()_+-', 1, 'chỉ ký tự đặc biệt'],
      ['abcdefghij123', 2, 'thường + số'],
      ['ABCDEFGHIJ123', 2, 'hoa + số'],
      ['abcdefghijKLM', 2, 'thường + hoa'],
    ])('từ chối %j (%i nhóm — %s)', (plain) => {
      const result = checkPasswordStrength(plain);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('3 trong 4');
    });

    it.each([
      ['abcdefghijK12', 'thường + hoa + số'],
      ['abcdefghij1!2', 'thường + số + đặc biệt'],
      ['ABCDEFGHIJ1!2', 'hoa + số + đặc biệt'],
      ['abcdefghiJK!@', 'thường + hoa + đặc biệt'],
      ['Abcdef123!@#x', 'đủ cả 4 nhóm'],
    ])('chấp nhận %j (%s)', (plain) => {
      expect(plain.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
      expect(checkPasswordStrength(plain)).toEqual({ ok: true });
    });
  });

  it('ký tự unicode/khoảng trắng tính là nhóm "đặc biệt", không làm hàm ném', () => {
    expect(() => checkPasswordStrength('Mật khẩu Việt 123')).not.toThrow();
    expect(checkPasswordStrength('Mật khẩu Việt 123').ok).toBe(true);
  });
});
