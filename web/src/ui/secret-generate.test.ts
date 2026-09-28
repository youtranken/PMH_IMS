import { describe, expect, it } from 'vitest';
import { checkSecretStrength } from './secret-strength';
import { generateSecret, SECRET_AMBIGUOUS } from './secret-generate';

/**
 * Nút "Tạo ngẫu nhiên" ở hộp Cất/Đổi giá trị: giá trị sinh ra phải qua được chính thanh đo độ
 * khó của hộp, và không có ký tự dễ đọc nhầm khi phải gõ tay sang console thiết bị.
 */
describe('generateSecret', () => {
  it('đủ độ dài, đủ bốn lớp ký tự → thanh đo báo mạnh', () => {
    for (let i = 0; i < 200; i += 1) {
      const value = generateSecret(20);
      expect(value).toHaveLength(20);
      expect(checkSecretStrength(value).strong).toBe(true);
    }
  });

  it('không có ký tự dễ nhầm (0/O, 1/l/I, |, `, khoảng trắng)', () => {
    const joined = Array.from({ length: 200 }, () => generateSecret(20)).join('');
    for (const ch of SECRET_AMBIGUOUS) expect(joined).not.toContain(ch);
    expect(joined).not.toMatch(/\s/);
  });

  it('dùng nguồn ngẫu nhiên được truyền vào (crypto) — cùng nguồn ra cùng chuỗi', () => {
    const fixed = (buf: Uint32Array) => {
      buf.fill(7);
      return buf;
    };
    expect(generateSecret(12, fixed)).toBe(generateSecret(12, fixed));
    expect(generateSecret(12)).not.toBe(generateSecret(12));
  });

  it('độ dài dưới 4 vẫn trả đủ bốn lớp (sàn 4)', () => {
    expect(generateSecret(2)).toHaveLength(4);
  });
});
