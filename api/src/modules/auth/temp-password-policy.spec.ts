import { isTempPasswordExpired, tempPasswordExpiresAt } from './temp-password-policy';

const NOW = new Date('2026-10-01T10:00:00Z');

describe('tempPasswordExpiresAt — mật khẩu tạm sống N giờ kể từ lúc cấp (Q-20)', () => {
  it.each([
    [24, '2026-10-02T10:00:00.000Z'],
    [1, '2026-10-01T11:00:00.000Z'],
    [168, '2026-10-08T10:00:00.000Z'],
  ])('%i giờ → %s', (hours, expected) => {
    expect(tempPasswordExpiresAt(NOW, hours).toISOString()).toBe(expected);
  });
});

describe('isTempPasswordExpired', () => {
  const cases: Array<{
    name: string;
    mustChangePassword: boolean;
    expiresAt: string | null;
    expired: boolean;
  }> = [
    { name: 'còn 1 giây → còn dùng được', mustChangePassword: true, expiresAt: '2026-10-01T10:00:01Z', expired: false },
    { name: 'đúng mốc hết hạn → hết', mustChangePassword: true, expiresAt: '2026-10-01T10:00:00Z', expired: true },
    { name: 'quá 1 giây → hết', mustChangePassword: true, expiresAt: '2026-10-01T09:59:59Z', expired: true },
    // SA dựng bằng seed-sa không mang hạn: chưa có SA nào khác để đặt lại cho họ.
    { name: 'bắt đổi nhưng không có hạn → không hết', mustChangePassword: true, expiresAt: null, expired: false },
    // Đã tự đặt mật khẩu: mật khẩu thường không có hạn định kỳ, kể cả còn sót mốc cũ.
    { name: 'đã đổi mật khẩu → không bao giờ hết', mustChangePassword: false, expiresAt: '2026-09-01T00:00:00Z', expired: false },
  ];

  it.each(cases)('$name', ({ mustChangePassword, expiresAt, expired }) => {
    expect(
      isTempPasswordExpired(
        { mustChangePassword, tempPasswordExpiresAt: expiresAt ? new Date(expiresAt) : null },
        NOW,
      ),
    ).toBe(expired);
  });
});
