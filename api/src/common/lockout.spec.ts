import {
  isLocked,
  lockRemainingSeconds,
  registerFailure,
  registerSuccess,
  type LockoutState,
} from './lockout';

const POLICY = { maxFailedAttempts: 5, lockoutMinutes: 15 };
const NOW = new Date('2026-08-22T10:00:00Z');
const fresh: LockoutState = { failedAttempts: 0, lockedUntil: null };

describe('lockout — NFR-01: sai 5 lần khóa 15 phút, tự mở', () => {
  it('4 lần sai đầu chưa khóa', () => {
    let state: LockoutState = fresh;
    for (let i = 1; i <= 4; i += 1) {
      const next = registerFailure(state, POLICY, NOW);
      expect(next.justLocked).toBe(false);
      expect(next.lockedUntil).toBeNull();
      expect(next.failedAttempts).toBe(i);
      state = next;
    }
  });

  it('lần sai thứ 5 khóa đúng 15 phút', () => {
    const state: LockoutState = { failedAttempts: 4, lockedUntil: null };
    const next = registerFailure(state, POLICY, NOW);
    expect(next.justLocked).toBe(true);
    expect(next.lockedUntil).toEqual(new Date('2026-08-22T10:15:00Z'));
    expect(isLocked(next, NOW)).toBe(true);
  });

  it('đang khóa: còn 15 phút thì trả 900 giây', () => {
    const locked = { failedAttempts: 5, lockedUntil: new Date('2026-08-22T10:15:00Z') };
    expect(lockRemainingSeconds(locked, NOW)).toBe(900);
  });

  it('hết 15 phút thì tự mở, không cần SA can thiệp', () => {
    const locked = { failedAttempts: 5, lockedUntil: new Date('2026-08-22T10:15:00Z') };
    const after = new Date('2026-08-22T10:15:01Z');
    expect(isLocked(locked, after)).toBe(false);
    expect(lockRemainingSeconds(locked, after)).toBe(0);
  });

  it('sai tiếp sau khi khóa đã hết hạn thì đếm lại từ 1, không khóa ngay', () => {
    const expired = { failedAttempts: 5, lockedUntil: new Date('2026-08-22T09:00:00Z') };
    const next = registerFailure(expired, POLICY, NOW);
    expect(next.failedAttempts).toBe(1);
    expect(next.justLocked).toBe(false);
  });

  it('sai TRONG lúc đang khóa thì bộ đếm tiếp tục tăng, khóa gia hạn', () => {
    const locked = { failedAttempts: 5, lockedUntil: new Date('2026-08-22T10:15:00Z') };
    const next = registerFailure(locked, POLICY, NOW);
    expect(next.failedAttempts).toBe(6);
    expect(next.lockedUntil).toEqual(new Date('2026-08-22T10:15:00Z'));
  });

  it('đăng nhập đúng xóa sạch bộ đếm và khóa', () => {
    expect(registerSuccess()).toEqual({ failedAttempts: 0, lockedUntil: null });
  });

  it('chưa từng sai thì không bị coi là khóa', () => {
    expect(isLocked(fresh, NOW)).toBe(false);
  });

  /**
   * `justLocked` = VỪA CHUYỂN sang khóa, KHÔNG phải "đang khóa" — nơi gọi dùng nó để gửi email
   * báo SA, nên trả sai là spam hộp thư của SA.
   *
   * Bản trước trả `true` cho mọi lượt sai từ ngưỡng trở đi. Lỗi đó bị CHE bởi một lỗi khác:
   * bộ đếm ở `login()` là đọc-rồi-ghi-đè nên các lượt song song đều ghi về 1, không lượt nào
   * chạm ngưỡng hai lần. Sửa lỗi đua (08/09) thì nó lộ ra — 6 lượt sai đồng thời đẻ hai dòng
   * `auth.account.locked` và hai thư. Đây là bài canh cho chuyện đó không quay lại.
   */
  it.each([
    {
      ten: 'lượt CHẠM ngưỡng: phải báo',
      state: { failedAttempts: 4, lockedUntil: null },
      justLocked: true,
    },
    {
      ten: 'lượt sai TIẾP khi đang khóa: KHÔNG báo lần nữa',
      state: { failedAttempts: 5, lockedUntil: new Date('2026-08-22T10:10:00Z') },
      justLocked: false,
    },
    {
      ten: 'lượt sai thứ ba khi đang khóa: vẫn KHÔNG báo',
      state: { failedAttempts: 9, lockedUntil: new Date('2026-08-22T10:10:00Z') },
      justLocked: false,
    },
    {
      ten: 'khóa cũ ĐÃ hết hạn: đếm lại từ 1, chưa chạm ngưỡng nên không báo',
      state: { failedAttempts: 9, lockedUntil: new Date('2026-08-22T09:00:00Z') },
      justLocked: false,
    },
  ])('$ten', ({ state, justLocked }) => {
    expect(registerFailure(state, POLICY, NOW).justLocked).toBe(justLocked);
  });

  it('hạ ngưỡng giữa chừng: đang 7 lượt sai chưa khóa, hạ về 5 thì lượt kế PHẢI báo', () => {
    // Ca hiếm nhưng thật: admin siết `login.max_failed_attempts` trong lúc có người đang dở.
    // So bằng `=== maxFailedAttempts` sẽ bỏ sót đúng ca này, nên bài kiểm ghim nó lại.
    const next = registerFailure(
      { failedAttempts: 7, lockedUntil: null },
      { maxFailedAttempts: 5, lockoutMinutes: 15 },
      NOW,
    );
    expect(next.failedAttempts).toBe(8);
    expect(next.justLocked).toBe(true);
  });

  it('đổi luật qua system_config có hiệu lực ngay (3 lần / 60 phút)', () => {
    const next = registerFailure(
      { failedAttempts: 2, lockedUntil: null },
      { maxFailedAttempts: 3, lockoutMinutes: 60 },
      NOW,
    );
    expect(next.justLocked).toBe(true);
    expect(next.lockedUntil).toEqual(new Date('2026-08-22T11:00:00Z'));
  });
});
