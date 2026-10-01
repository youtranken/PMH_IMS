import {
  canEnrollWithoutPassword,
  evaluateSession,
  isStepUpValid,
  isTotpChallengeExpired,
  stepUpSecondsLeft,
} from './session-policy';

const NOW = new Date('2026-08-22T10:00:00Z');
const alive = {
  lastSeenAt: new Date('2026-08-22T09:50:00Z'),
  absoluteExpiresAt: new Date('2026-08-22T20:00:00Z'),
  revokedAt: null,
};

describe('evaluateSession — NFR-01 idle 30 phút / absolute 12 giờ', () => {
  it('vừa hoạt động 10 phút trước → còn sống', () => {
    expect(evaluateSession(alive, 30, NOW)).toBe('alive');
  });

  it('đúng 30 phút không hoạt động → chết vì idle', () => {
    const s = { ...alive, lastSeenAt: new Date('2026-08-22T09:30:00Z') };
    expect(evaluateSession(s, 30, NOW)).toBe('idle-expired');
  });

  it('29 phút 59 giây vẫn sống', () => {
    const s = { ...alive, lastSeenAt: new Date('2026-08-22T09:30:01Z') };
    expect(evaluateSession(s, 30, NOW)).toBe('alive');
  });

  it('quá trần tuyệt đối thì chết dù vừa mới hoạt động', () => {
    const s = {
      lastSeenAt: NOW,
      absoluteExpiresAt: new Date('2026-08-22T09:59:59Z'),
      revokedAt: null,
    };
    expect(evaluateSession(s, 30, NOW)).toBe('absolute-expired');
  });

  it('SA đá phiên thì chết ngay, ưu tiên hơn mọi lý do khác', () => {
    const s = { ...alive, revokedAt: new Date('2026-08-22T09:59:00Z') };
    expect(evaluateSession(s, 30, NOW)).toBe('revoked');
  });

  it('đổi idle qua system_config có hiệu lực ngay', () => {
    const s = { ...alive, lastSeenAt: new Date('2026-08-22T09:55:00Z') };
    expect(evaluateSession(s, 5, NOW)).toBe('idle-expired');
    expect(evaluateSession(s, 10, NOW)).toBe('alive');
  });
});

describe('isStepUpValid — FR-022 grace 10 phút', () => {
  it('chưa gõ TOTP lần nào → không hợp lệ', () => {
    expect(isStepUpValid(null, 10, NOW)).toBe(false);
  });

  it('gõ 9 phút trước → còn hiệu lực', () => {
    expect(isStepUpValid(new Date('2026-08-22T09:51:00Z'), 10, NOW)).toBe(true);
  });

  it('gõ đúng 10 phút trước → hết hiệu lực, phải gõ lại', () => {
    expect(isStepUpValid(new Date('2026-08-22T09:50:00Z'), 10, NOW)).toBe(false);
  });
});

/**
 * Con số bên PHẢI của đồng hồ đếm ngược trong hộp hiện secret ("60s / 600s").
 *
 * Client không tự tính được: nó không biết `stepped_up_at`. Tự đếm từ lần gõ mã gần nhất thì
 * mỗi tab của cùng một phiên ra một con số khác nhau — và con số đó là thứ người dùng dựa vào
 * để quyết định "mở nốt cái nữa hay gõ lại mã cho chắc".
 */
describe('stepUpSecondsLeft — còn bao lâu nữa phải gõ lại mã', () => {
  const cases: { name: string; at: string | null; grace: number; expected: number }[] = [
    { name: 'chưa gõ lần nào', at: null, grace: 10, expected: 0 },
    { name: 'vừa gõ xong', at: '2026-08-22T10:00:00Z', grace: 10, expected: 600 },
    { name: 'gõ 1 phút trước', at: '2026-08-22T09:59:00Z', grace: 10, expected: 540 },
    // Mở secret thứ hai sau 10 giây: đúng cái "60s/590s" mà người dùng thấy.
    { name: 'gõ 10 giây trước', at: '2026-08-22T09:59:50Z', grace: 10, expected: 590 },
    { name: 'gõ 9 phút 59 giây trước', at: '2026-08-22T09:50:01Z', grace: 10, expected: 1 },
    // Hết hạn thì 0, KHÔNG phải số âm — số âm rơi thẳng vào giao diện thành "-37s".
    { name: 'đúng lúc hết hạn', at: '2026-08-22T09:50:00Z', grace: 10, expected: 0 },
    { name: 'đã quá hạn từ lâu', at: '2026-08-22T08:00:00Z', grace: 10, expected: 0 },
    // AD-11: đổi grace trong system_config là đổi ngay, không phải sửa code.
    { name: 'grace 2 phút', at: '2026-08-22T09:59:00Z', grace: 2, expected: 60 },
  ];

  for (const { name, at, grace, expected } of cases) {
    it(`${name} (grace ${grace}p) → ${expected}s`, () => {
      expect(stepUpSecondsLeft(at === null ? null : new Date(at), grace, NOW)).toBe(expected);
    });
  }
});

/**
 * A-02: ai được miễn gõ lại mật khẩu khi cài yếu tố thứ hai.
 *
 * Bảng dữ liệu vì đây là một phép AND hai vế, và cả hai vế đều có một biên dễ viết ngược:
 * `totp_pending` là vế "đang ở giữa luồng đăng nhập", tuổi phiên là vế "chưa bị bỏ quên".
 */
describe('canEnrollWithoutPassword — cửa sổ miễn xác thực lại', () => {
  const REAUTH_MINUTES = 15;

  const cases: { name: string; totpPending: boolean; createdAt: string; expected: boolean }[] = [
    {
      name: 'phiên còn chờ, vừa tạo 1 phút trước → miễn (đúng luồng cài 2 lớp bắt buộc)',
      totpPending: true,
      createdAt: '2026-08-22T09:59:00Z',
      expected: true,
    },
    {
      name: 'phiên còn chờ, 14 phút trước → vẫn miễn',
      totpPending: true,
      createdAt: '2026-08-22T09:46:00Z',
      expected: true,
    },
    {
      name: 'phiên còn chờ, ĐÚNG 15 phút trước → hết miễn (biên đóng)',
      totpPending: true,
      createdAt: '2026-08-22T09:45:00Z',
      expected: false,
    },
    {
      name: 'phiên còn chờ bị bỏ quên 1 giờ → hết miễn',
      totpPending: true,
      createdAt: '2026-08-22T09:00:00Z',
      expected: false,
    },
    {
      name: 'phiên ĐÃ đăng nhập đủ, vừa tạo xong → vẫn phải gõ mật khẩu (đây là A-02)',
      totpPending: false,
      createdAt: '2026-08-22T09:59:59Z',
      expected: false,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const session = { totpPending: c.totpPending, createdAt: new Date(c.createdAt) };
      expect(canEnrollWithoutPassword(session, REAUTH_MINUTES, NOW)).toBe(c.expected);
    });
  }

  it('ngưỡng 0 = không ai được miễn, kể cả phiên vừa sinh ra', () => {
    const session = { totpPending: true, createdAt: NOW };
    expect(canEnrollWithoutPassword(session, 0, NOW)).toBe(false);
  });
});

describe('isTotpChallengeExpired — phiên chờ nhập mã 2 lớp sống tối đa N phút (Q-20)', () => {
  const MINUTES = 5;
  const cases: Array<{
    name: string;
    totpPending: boolean;
    enrolled: boolean;
    createdAt: string;
    expected: boolean;
  }> = [
    { name: 'vừa nhập mật khẩu 4:59 trước → còn nhập được', totpPending: true, enrolled: true, createdAt: '2026-08-22T09:55:01Z', expected: false },
    { name: 'đúng 5 phút → hết', totpPending: true, enrolled: true, createdAt: '2026-08-22T09:55:00Z', expected: true },
    { name: 'bỏ quên 1 giờ → hết', totpPending: true, enrolled: true, createdAt: '2026-08-22T09:00:00Z', expected: true },
    {
      name: 'luồng CÀI 2 lớp bắt buộc (chưa có mã) không bị luật này cắt — tải app mất thời gian',
      totpPending: true,
      enrolled: false,
      createdAt: '2026-08-22T09:00:00Z',
      expected: false,
    },
    { name: 'phiên đã đăng nhập đủ thì không liên quan', totpPending: false, enrolled: true, createdAt: '2026-08-22T01:00:00Z', expected: false },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const session = { totpPending: c.totpPending, createdAt: new Date(c.createdAt) };
      expect(isTotpChallengeExpired(session, c.enrolled, MINUTES, NOW)).toBe(c.expected);
    });
  }
});
