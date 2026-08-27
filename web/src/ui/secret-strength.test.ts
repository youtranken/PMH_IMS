import { describe, expect, it } from 'vitest';
import { checkSecretStrength, SECRET_MIN_LENGTH, type SecretRuleKey } from './secret-strength';

function metKeys(value: string): SecretRuleKey[] {
  return checkSecretStrength(value)
    .rules.filter((rule) => rule.met)
    .map((rule) => rule.key);
}

describe('checkSecretStrength — đo độ khó giá trị secret', () => {
  const cases: { name: string; value: string; met: SecretRuleKey[]; strong: boolean }[] = [
    { name: 'ô trống', value: '', met: [], strong: false },
    { name: 'toàn chữ thường, ngắn', value: 'admin', met: ['lower'], strong: false },
    {
      name: 'đủ dài nhưng chỉ một nhóm',
      value: 'adminadmin',
      met: ['length', 'lower'],
      strong: false,
    },
    {
      name: 'thiếu đúng ký tự đặc biệt',
      value: 'Admin2026',
      met: ['length', 'lower', 'upper', 'digit'],
      strong: false,
    },
    {
      // Đúng 8 ký tự — biên, phải TÍNH LÀ ĐẠT chứ không phải "trên 8".
      name: 'vừa đủ 8 ký tự, đủ bốn nhóm',
      value: 'Ab1!cdef',
      met: ['length', 'lower', 'upper', 'digit', 'symbol'],
      strong: true,
    },
    {
      name: '7 ký tự thì chưa đạt độ dài',
      value: 'Ab1!cde',
      met: ['lower', 'upper', 'digit', 'symbol'],
      strong: false,
    },
    {
      name: 'mật khẩu thiết bị thật',
      value: 'Qw3rty!@#$%^&*()',
      met: ['length', 'lower', 'upper', 'digit', 'symbol'],
      strong: true,
    },
    {
      // Khoảng trắng cũng là ký tự đặc biệt: passphrase "Toi la ai 2026" không đoán dễ.
      name: 'khoảng trắng tính là ký tự đặc biệt',
      value: 'Toi La Ai 2026',
      met: ['length', 'lower', 'upper', 'digit', 'symbol'],
      strong: true,
    },
    {
      // Tiếng Việt có dấu rơi vào nhóm "không phải chữ-số ASCII" — đúng, và không sai gì.
      name: 'chữ có dấu tính là ký tự đặc biệt',
      value: 'Mậtkhẩu2026',
      met: ['length', 'lower', 'upper', 'digit', 'symbol'],
      strong: true,
    },
  ];

  for (const { name, value, met, strong } of cases) {
    it(`${name} → ${met.length}/5${strong ? ', mạnh' : ''}`, () => {
      expect(metKeys(value)).toEqual(met);
      expect(checkSecretStrength(value).strong).toBe(strong);
      expect(checkSecretStrength(value).score).toBe(met.length);
    });
  }

  it('ô trống được đánh dấu riêng, không phải "yếu"', () => {
    expect(checkSecretStrength('').empty).toBe(true);
    expect(checkSecretStrength('a').empty).toBe(false);
  });

  it('ngưỡng độ dài của két (8) THẤP hơn mật khẩu đăng nhập IMS (12) — có chủ ý', () => {
    expect(SECRET_MIN_LENGTH).toBe(8);
  });
});
