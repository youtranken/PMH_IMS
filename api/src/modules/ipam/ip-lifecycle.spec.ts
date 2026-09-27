import {
  ALLOWED_TRANSITIONS,
  IP_LIFECYCLE_STATUSES,
  OCCUPYING_STATUSES,
  canTransition,
  isOccupying,
  nextStatuses,
  transitionLabel,
  type IpStatus,
} from './ip-lifecycle';

describe('IP_LIFECYCLE_STATUSES — chỉ hai trạng thái (Q-02)', () => {
  /**
   * Thêm lại trạng thái thứ ba phải là một quyết định nghiệp vụ mới, không phải một dòng code
   * lặng lẽ: CHECK ở DB, bộ lọc trên màn dải và nhãn trong vi.ts đều giả định đúng hai giá trị.
   */
  it('chỉ có trống và đang dùng', () => {
    expect([...IP_LIFECYCLE_STATUSES]).toEqual(['free', 'assigned']);
  });
});

describe('canTransition — máy trạng thái vòng đời IP (AC 5.2, Q-02)', () => {
  it.each([
    ['free', 'assigned', true],
    // Thu hồi = trả địa chỉ về pool. Lịch sử giữ "ai thu hồi, lúc nào", hàng thì trống lại.
    ['assigned', 'free', true],
  ] as [IpStatus, IpStatus, boolean][])('%s → %s = %s', (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });

  /**
   * Trạng thái lạ (hàng cũ lọt qua, body gửi bừa) không được coi là đường đi hợp lệ — thiếu
   * vế này thì `ALLOWED_TRANSITIONS[from]` trả `undefined` và `.includes` nổ thành lỗi 500.
   */
  it.each([
    ['suspect_dead', 'assigned'],
    ['assigned', 'reclaimed'],
    ['reclaimed', 'assigned'],
  ] as unknown as [IpStatus, IpStatus][])('chặn trạng thái đã bỏ %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  /**
   * Đứng yên KHÔNG phải là một bước chuyển. Cho phép thì mỗi lần bấm nhầm lại đẻ thêm một
   * dòng lịch sử "đang dùng → đang dùng" — lịch sử loãng ra và mất luôn giá trị tra cứu.
   */
  it.each(['free', 'assigned'] as IpStatus[])('chặn %s → chính nó', (status) => {
    expect(canTransition(status, status)).toBe(false);
  });

  it('mọi trạng thái đều có đường đi tiếp — không có ngõ cụt', () => {
    for (const status of IP_LIFECYCLE_STATUSES) {
      expect(nextStatuses(status).length).toBeGreaterThan(0);
    }
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual(['assigned', 'free']);
  });
});

describe('isOccupying — IP nào đang thực sự CHIẾM một địa chỉ (FR-020)', () => {
  it.each([
    ['assigned', true],
    ['free', false],
  ] as [IpStatus, boolean][])('%s → %s', (status, expected) => {
    expect(isOccupying(status)).toBe(expected);
  });

  it('chỉ "đang dùng" chiếm chỗ', () => {
    expect(OCCUPYING_STATUSES).toEqual(['assigned']);
  });
});

describe('transitionLabel — tên thao tác bằng tiếng Việt', () => {
  /**
   * Chữ này đồng thời là cột `action` của `ip_history`. Giữ đúng "Thu hồi" như trước để tra
   * lịch sử cũ và mới bằng cùng một chữ.
   */
  it.each([
    ['free', 'assigned', 'Cấp IP'],
    ['assigned', 'free', 'Thu hồi'],
  ] as [IpStatus, IpStatus, string][])('%s → %s = %s', (from, to, expected) => {
    expect(transitionLabel(from, to)).toBe(expected);
  });

  it('mọi bước chuyển hợp lệ đều có tên — không nút nào hiện chữ undefined', () => {
    for (const from of IP_LIFECYCLE_STATUSES) {
      for (const to of nextStatuses(from)) {
        expect(transitionLabel(from, to)).toBeTruthy();
      }
    }
  });
});
