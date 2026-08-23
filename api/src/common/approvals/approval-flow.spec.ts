import {
  ApprovalFlow,
  isGrantActive,
  overdueSince,
  type ApprovalFlowSpec,
} from './approval-flow';

const BREAK_GLASS: ApprovalFlowSpec = {
  kind: 'break_glass',
  initial: 'pending',
  transitions: {
    pending: ['approved', 'denied', 'cancelled'],
    approved: ['expired', 'revoked'],
    denied: [],
    cancelled: [],
    expired: [],
    revoked: [],
  },
  labels: {
    'pending->approved': 'Duyệt',
    'pending->denied': 'Từ chối',
    'pending->cancelled': 'Người xin tự hủy',
    'approved->expired': 'Hết hạn',
    'approved->revoked': 'Thu hồi sớm',
  },
};

describe('ApprovalFlow — từ vựng state đăng ký THEO LOẠI (AD-6)', () => {
  const flow = new ApprovalFlow(BREAK_GLASS);

  it('bắt đầu ở state khai báo', () => {
    expect(flow.initial).toBe('pending');
  });

  it.each([
    ['pending', 'approved', true],
    ['pending', 'denied', true],
    ['pending', 'cancelled', true],
    ['approved', 'expired', true],
    ['approved', 'revoked', true],
  ] as [string, string, boolean][])('%s → %s = %s', (from, to, expected) => {
    expect(flow.can(from, to)).toBe(expected);
  });

  /**
   * Đã từ chối rồi thì KHÔNG duyệt lại được. Muốn cấp thì xin cái mới — để nhật ký còn đọc
   * được: một dòng "đã từ chối" đổi thành "đã duyệt" là một dòng nói dối về quá khứ.
   */
  it.each([
    ['denied', 'approved'],
    ['cancelled', 'approved'],
    ['expired', 'approved'],
    ['revoked', 'approved'],
    ['approved', 'denied'],
    ['pending', 'expired'],
  ] as [string, string][])('chặn %s → %s', (from, to) => {
    expect(flow.can(from, to)).toBe(false);
  });

  it('chặn đứng yên — không đẻ dòng lịch sử vô nghĩa', () => {
    expect(flow.can('pending', 'pending')).toBe(false);
    expect(flow.can('approved', 'approved')).toBe(false);
  });

  it('state lạ (dữ liệu cũ, loại khác) không lọt qua', () => {
    expect(flow.can('khong_ton_tai', 'approved')).toBe(false);
    expect(flow.can('pending', 'khong_ton_tai')).toBe(false);
  });

  it('nói được từ đây đi tiếp được đâu — lỗi phải CHỈ ĐƯỜNG', () => {
    expect(flow.next('pending').sort()).toEqual(['approved', 'cancelled', 'denied']);
    expect(flow.next('denied')).toEqual([]);
  });

  it('mọi bước chuyển hợp lệ đều có nhãn tiếng Việt', () => {
    for (const from of Object.keys(BREAK_GLASS.transitions)) {
      for (const to of flow.next(from)) {
        expect(flow.label(from, to)).toBeTruthy();
      }
    }
  });

  /** State cuối (không đi đâu được) phải nhận ra được — UI ẩn hết nút thao tác. */
  it('nhận ra state cuối', () => {
    expect(flow.isFinal('denied')).toBe(true);
    expect(flow.isFinal('expired')).toBe(true);
    expect(flow.isFinal('pending')).toBe(false);
    expect(flow.isFinal('approved')).toBe(false);
  });
});

/**
 * AD-6 nói thẳng: "hiệu lực kiểm tại MỖI lần đọc bằng `expires_at > now()` — KHÔNG tin status".
 *
 * Vì sao gắt thế: sweep dọn grant hết hạn có thể chết, có thể chạy trễ, có thể bị tắt lúc bảo
 * trì. Tin `status = 'approved'` thì một grant 24 giờ trở thành grant vĩnh viễn chỉ vì cron
 * không chạy — và không ai phát hiện, vì mọi thứ trông vẫn bình thường.
 */
describe('isGrantActive — hiệu lực tính bằng ĐỒNG HỒ, không bằng status', () => {
  const now = new Date('2026-08-23T10:00:00Z');

  it('đã duyệt và chưa tới hạn → còn hiệu lực', () => {
    expect(isGrantActive('approved', new Date('2026-08-23T11:00:00Z'), now)).toBe(true);
  });

  it('đã duyệt nhưng QUÁ hạn → hết, dù status vẫn là approved', () => {
    expect(isGrantActive('approved', new Date('2026-08-23T09:59:59Z'), now)).toBe(false);
  });

  it('đúng khoảnh khắc hết hạn → hết (dùng > chứ không >=)', () => {
    expect(isGrantActive('approved', now, now)).toBe(false);
  });

  it.each(['pending', 'denied', 'cancelled', 'expired', 'revoked'])(
    'status %s thì không bao giờ có hiệu lực, kể cả expires_at còn xa',
    (status) => {
      expect(isGrantActive(status, new Date('2027-01-01T00:00:00Z'), now)).toBe(false);
    },
  );

  /** Đã duyệt mà KHÔNG có hạn là dữ liệu hỏng — từ chối, không cho là vô hạn. */
  it('không có expires_at thì KHÔNG có hiệu lực', () => {
    expect(isGrantActive('approved', null, now)).toBe(false);
  });
});

describe('overdueSince — nhắc yêu cầu treo quá lâu', () => {
  const now = new Date('2026-08-23T10:00:00Z');

  it('chưa quá ngưỡng thì chưa nhắc', () => {
    expect(overdueSince(new Date('2026-08-23T08:00:00Z'), 4, now)).toBe(false);
  });

  it('quá ngưỡng thì nhắc', () => {
    expect(overdueSince(new Date('2026-08-23T05:00:00Z'), 4, now)).toBe(true);
  });

  it('đúng mốc ngưỡng cũng nhắc — dùng >=, để lỡ nhịp sweep vẫn nhắc bù', () => {
    expect(overdueSince(new Date('2026-08-23T06:00:00Z'), 4, now)).toBe(true);
  });

  /** Ngưỡng 0 (admin tắt nhắc) không được biến thành "nhắc mọi thứ mỗi phút". */
  it('ngưỡng 0 nghĩa là TẮT nhắc, không phải nhắc liên tục', () => {
    expect(overdueSince(new Date('2026-08-23T09:59:00Z'), 0, now)).toBe(false);
  });
});
