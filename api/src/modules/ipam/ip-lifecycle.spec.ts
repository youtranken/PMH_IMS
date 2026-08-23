import {
  ALLOWED_TRANSITIONS,
  OCCUPYING_STATUSES,
  canTransition,
  isOccupying,
  nextStatuses,
  transitionLabel,
  type IpStatus,
} from './ip-lifecycle';

describe('canTransition — máy trạng thái vòng đời IP (AC 5.2)', () => {
  it.each([
    ['free', 'assigned', true],
    ['assigned', 'suspect_dead', true],
    ['assigned', 'reclaimed', true],
    ['suspect_dead', 'reclaimed', true],
    // Đính chính: hóa ra máy vẫn sống. Không có đường này thì người ta buộc phải thu hồi rồi
    // cấp lại — hai dòng lịch sử sai sự thật cho một lần nhìn nhầm.
    ['suspect_dead', 'assigned', true],
    // AC 5.2: "IP đã thu hồi cấp lại được cho thiết bị khác".
    ['reclaimed', 'assigned', true],
  ] as [IpStatus, IpStatus, boolean][])('%s → %s = %s', (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });

  it.each([
    ['free', 'reclaimed'],
    ['free', 'suspect_dead'],
    ['assigned', 'free'],
    ['reclaimed', 'suspect_dead'],
    ['suspect_dead', 'free'],
    ['reclaimed', 'free'],
  ] as [IpStatus, IpStatus][])('chặn %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  /**
   * Đứng yên KHÔNG phải là một bước chuyển. Cho phép thì mỗi lần bấm nhầm lại đẻ thêm một
   * dòng lịch sử "đang cấp → đang cấp" — lịch sử loãng ra và mất luôn giá trị tra cứu.
   */
  it.each(['free', 'assigned', 'suspect_dead', 'reclaimed'] as IpStatus[])(
    'chặn %s → chính nó',
    (status) => {
      expect(canTransition(status, status)).toBe(false);
    },
  );

  it('mọi trạng thái đều có đường đi tiếp — không có ngõ cụt', () => {
    for (const status of Object.keys(ALLOWED_TRANSITIONS) as IpStatus[]) {
      expect(nextStatuses(status).length).toBeGreaterThan(0);
    }
  });

  /**
   * Mọi trạng thái phải TỚI được từ `free` — trạng thái không tới được là trạng thái chết
   * nằm trong bảng CHECK của DB mà không ai vào được, và sẽ có người tưởng nó dùng được.
   */
  it('mọi trạng thái đều tới được từ "trống"', () => {
    const seen = new Set<IpStatus>(['free']);
    const queue: IpStatus[] = ['free'];
    while (queue.length > 0) {
      for (const next of nextStatuses(queue.shift() as IpStatus)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect([...seen].sort()).toEqual(['assigned', 'free', 'reclaimed', 'suspect_dead']);
  });
});

describe('isOccupying — IP nào đang thực sự CHIẾM một địa chỉ (FR-020)', () => {
  it.each([
    ['assigned', true],
    ['suspect_dead', true],
    ['free', false],
    ['reclaimed', false],
  ] as [IpStatus, boolean][])('%s → %s', (status, expected) => {
    expect(isOccupying(status)).toBe(expected);
  });

  /**
   * "Đã thu hồi" KHÔNG chiếm chỗ: đó chính là ý nghĩa của thu hồi — trả địa chỉ về pool.
   * Đếm nó là đang dùng thì mức sử dụng chỉ có tăng, không bao giờ giảm, và sau một năm màn
   * hình báo dải đầy trong khi thực tế còn quá nửa.
   */
  it('thu hồi rồi thì trả chỗ về pool, không đếm là đang dùng', () => {
    expect(isOccupying('reclaimed')).toBe(false);
    expect(OCCUPYING_STATUSES).toEqual(['assigned', 'suspect_dead']);
  });

  /** "Nghi chết" VẪN chiếm chỗ: chưa ai xác nhận máy chết thì chưa được cấp cho người khác. */
  it('nghi chết vẫn giữ chỗ cho tới khi thu hồi', () => {
    expect(isOccupying('suspect_dead')).toBe(true);
  });
});

describe('transitionLabel — tên thao tác bằng tiếng Việt', () => {
  it.each([
    ['free', 'assigned', 'Cấp IP'],
    ['assigned', 'suspect_dead', 'Đánh dấu nghi chết'],
    ['assigned', 'reclaimed', 'Thu hồi'],
    ['suspect_dead', 'assigned', 'Xác nhận vẫn dùng'],
    ['suspect_dead', 'reclaimed', 'Thu hồi'],
    ['reclaimed', 'assigned', 'Cấp lại'],
  ] as [IpStatus, IpStatus, string][])('%s → %s = %s', (from, to, expected) => {
    expect(transitionLabel(from, to)).toBe(expected);
  });

  it('mọi bước chuyển hợp lệ đều có tên — không nút nào hiện chữ undefined', () => {
    for (const from of Object.keys(ALLOWED_TRANSITIONS) as IpStatus[]) {
      for (const to of nextStatuses(from)) {
        expect(transitionLabel(from, to)).toBeTruthy();
      }
    }
  });
});
