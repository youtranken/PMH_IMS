import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';

/*
 * `t` truyền vào đây là `t` THẬT của app (`@/lib/i18n`, đã nạp bản dịch tiếng Việt), KHÔNG
 * phải một stub trả lại chính cái khóa.
 *
 * Đó là chỗ bài kiểm này đáng giá hơn trước: mọi câu khẳng định bên dưới so với CHỮ THẬT trên
 * màn hình, nên một khóa gõ sai hay một khóa quên khai trong `vi.ts` sẽ làm đỏ ngay tại đây —
 * đúng lớp lỗi của mục #1 bản rà soát (i18next rơi về chính cái khóa và không ai thấy).
 */
const t = i18n.t;
import {
  actionLabel,
  statusLabel,
  toIpHistoryEntries,
  type IpHistoryRow,
} from './ip-history-entries';

function row(over: Partial<IpHistoryRow> = {}): IpHistoryRow {
  return {
    id: 'h1',
    action: 'Thu hồi',
    actor: 'it01@pmh.com.vn',
    fromStatus: 'assigned',
    toStatus: 'free',
    changes: null,
    createdAt: '2026-08-23T02:00:00.000Z',
    ...over,
  };
}

describe('toIpHistoryEntries — lịch sử IP đọc được (story 5.2)', () => {
  it('nói rõ chuyển từ trạng thái nào sang trạng thái nào, bằng tiếng Việt', () => {
    const [entry] = toIpHistoryEntries([row()], t);
    expect(entry.action).toBe('Thu hồi');
    expect(entry.detail).toContain('Đang cấp → Trống');
    expect(entry.actor).toBe('it01@pmh.com.vn');
  });

  /**
   * Đây là câu mà cả story 5.2 sinh ra để trả lời: "IP này từng là máy in kế toán".
   * Sau khi thu hồi thì hồ sơ IP không còn giữ chủ cũ nữa — chỉ dòng lịch sử này giữ.
   */
  it('dòng THU HỒI nói ra chủ cũ, vì hồ sơ đã không còn giữ', () => {
    const [entry] = toIpHistoryEntries([
      row({
        changes: {
          previousUsedBy: 'Máy in kế toán',
          previousDeviceId: 'dev-1',
          usedBy: null,
          deviceId: null,
          reason: 'máy đã thanh lý',
        },
      }),
    ], t);
    expect(entry.detail).toContain('trước đó: Máy in kế toán');
    expect(entry.detail).toContain('lý do: máy đã thanh lý');
  });

  /**
   * Nhưng KHÔNG lặp lại chủ cũ ở những dòng mà chủ vẫn còn: mỗi bước chuyển đều kèm
   * "trước đó: …" thì dòng thu hồi — dòng duy nhất quan trọng — chìm nghỉm giữa đám đó.
   */
  it('không nhắc chủ cũ khi hồ sơ vẫn còn chủ', () => {
    const [entry] = toIpHistoryEntries([
      row({
        action: 'ip.updated',
        fromStatus: 'assigned',
        toStatus: 'assigned',
        changes: { previousUsedBy: 'Chị Lan', usedBy: 'Chị Lan', deviceId: null },
      }),
    ], t);
    expect(entry.detail).not.toContain('trước đó');
  });

  it('cấp IP thì nói cấp cho ai', () => {
    const [entry] = toIpHistoryEntries([
      row({
        action: 'Cấp IP',
        fromStatus: 'free',
        toStatus: 'assigned',
        changes: { usedBy: 'Anh Hùng — Kho', previousUsedBy: null },
      }),
    ], t);
    expect(entry.detail).toContain('Trống → Đang cấp');
    expect(entry.detail).toContain('cấp cho: Anh Hùng — Kho');
  });

  /**
   * `ip_history` là chỉ-thêm (AD-13) và giữ vĩnh viễn: dòng ghi từ hồi IP còn bốn trạng thái
   * vẫn mang `suspect_dead` / `reclaimed`, và vẫn phải đọc ra chữ, không phải khóa máy.
   */
  it.each([
    ['Đánh dấu nghi chết', 'assigned', 'suspect_dead', 'Đang cấp → Nghi chết'],
    ['Thu hồi', 'suspect_dead', 'reclaimed', 'Nghi chết → Đã thu hồi'],
    ['Cấp lại', 'reclaimed', 'assigned', 'Đã thu hồi → Đang cấp'],
  ])('dòng lịch sử cũ "%s" vẫn đọc được', (action, fromStatus, toStatus, expected) => {
    const [entry] = toIpHistoryEntries([row({ action, fromStatus, toStatus })], t);
    expect(entry.action).toBe(action);
    expect(entry.detail).toContain(expected);
  });

  it('dòng gộp trạng thái do migration ghi có tên việc bằng tiếng Việt', () => {
    const [entry] = toIpHistoryEntries([
      row({
        action: 'ip.status_merged',
        actor: 'system:migration',
        fromStatus: 'reclaimed',
        toStatus: 'free',
        changes: { reason: 'Q-02: IP chỉ còn hai trạng thái Trống / Đang dùng' },
      }),
    ], t);
    expect(entry.action).toBe('Gộp trạng thái');
    expect(entry.detail).toContain('Đã thu hồi → Trống');
  });

  it('bản ghi không có changes vẫn ra dòng đọc được, không phải "undefined"', () => {
    const [entry] = toIpHistoryEntries([
      row({ action: 'Tạo hồ sơ', fromStatus: null, toStatus: 'assigned', changes: null }),
    ], t);
    expect(entry.detail).toBe('Đang cấp');
  });

  it('chuỗi rỗng trong changes không đẻ ra "lý do: " cụt lủn', () => {
    const [entry] = toIpHistoryEntries([row({ changes: { reason: '   ', usedBy: '' } })], t);
    expect(entry.detail).not.toContain('lý do');
  });
});

/**
 * Bảng lịch sử trước 28/08/2026 xen kẽ hai thứ tiếng: bước chuyển mang tên tiếng Việt do API
 * đặt ("Thu hồi"), còn bốn hành động còn lại rơi ra nguyên khóa máy ("ip.voided").
 */
describe('actionLabel — tên việc bằng tiếng Việt', () => {
  it.each([
    ['ip.created', 'Tạo hồ sơ'],
    ['ip.updated', 'Sửa hồ sơ'],
    ['ip.assigned', 'Gán chủ'],
    ['ip.voided', 'Xóa hồ sơ'],
    ['ip.restored', 'Bật lại'],
    ['ip.status_merged', 'Gộp trạng thái'],
  ])('%s → %s', (action, expected) => {
    expect(actionLabel(action, t)).toBe(expected);
  });

  /** Bước chuyển đã là tiếng Việt sẵn — đi qua bảng này phải RA NGUYÊN, không bị nuốt. */
  it('tên bước chuyển do API đặt đi qua nguyên vẹn', () => {
    expect(actionLabel('Thu hồi', t)).toBe('Thu hồi');
    // Tên bước chuyển đã bỏ nhưng còn nằm trong lịch sử cũ.
    expect(actionLabel('Xác nhận vẫn dùng', t)).toBe('Xác nhận vẫn dùng');
  });

  it('khóa lạ giữ nguyên còn hơn hiện ô trống', () => {
    expect(actionLabel('ip.chuaTungCo', t)).toBe('ip.chuaTungCo');
  });

  it('dòng lịch sử đi qua toIpHistoryEntries cũng được dịch', () => {
    const [entry] = toIpHistoryEntries([
      row({ action: 'ip.restored', fromStatus: 'assigned', toStatus: 'assigned' }),
    ], t);
    expect(entry.action).toBe('Bật lại');
  });
});

describe('statusLabel', () => {
  it.each([
    ['free', 'Trống'],
    ['assigned', 'Đang cấp'],
    // Hai trạng thái đã bỏ (Q-02) chỉ còn sống trong lịch sử cũ — nhãn phải giữ.
    ['suspect_dead', 'Nghi chết'],
    ['reclaimed', 'Đã thu hồi'],
  ])('%s → %s', (status, expected) => {
    expect(statusLabel(status, t)).toBe(expected);
  });

  /** Trạng thái lạ (dữ liệu cũ, migration sau) giữ nguyên tên còn hơn hiện ô trống. */
  it('trạng thái lạ giữ nguyên, không nuốt mất', () => {
    expect(statusLabel('trang_thai_moi', t)).toBe('trang_thai_moi');
    expect(statusLabel(null, t)).toBe('—');
  });
});
