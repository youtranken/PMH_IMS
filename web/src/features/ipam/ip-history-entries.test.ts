import { describe, expect, it } from 'vitest';
import { statusLabel, toIpHistoryEntries, type IpHistoryRow } from './ip-history-entries';

function row(over: Partial<IpHistoryRow> = {}): IpHistoryRow {
  return {
    id: 'h1',
    action: 'Thu hồi',
    actor: 'it01@pmh.com.vn',
    fromStatus: 'assigned',
    toStatus: 'reclaimed',
    changes: null,
    createdAt: '2026-08-23T02:00:00.000Z',
    ...over,
  };
}

describe('toIpHistoryEntries — lịch sử IP đọc được (story 5.2)', () => {
  it('nói rõ chuyển từ trạng thái nào sang trạng thái nào, bằng tiếng Việt', () => {
    const [entry] = toIpHistoryEntries([row()]);
    expect(entry.action).toBe('Thu hồi');
    expect(entry.detail).toContain('Đang cấp → Đã thu hồi');
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
    ]);
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
        action: 'Đánh dấu nghi chết',
        fromStatus: 'assigned',
        toStatus: 'suspect_dead',
        changes: { previousUsedBy: 'Chị Lan', usedBy: 'Chị Lan', deviceId: null },
      }),
    ]);
    expect(entry.detail).not.toContain('trước đó');
  });

  it('cấp lại thì nói cấp cho ai', () => {
    const [entry] = toIpHistoryEntries([
      row({
        action: 'Cấp lại',
        fromStatus: 'reclaimed',
        toStatus: 'assigned',
        changes: { usedBy: 'Anh Hùng — Kho', previousUsedBy: null },
      }),
    ]);
    expect(entry.detail).toContain('Đã thu hồi → Đang cấp');
    expect(entry.detail).toContain('cấp cho: Anh Hùng — Kho');
  });

  it('bản ghi không có changes vẫn ra dòng đọc được, không phải "undefined"', () => {
    const [entry] = toIpHistoryEntries([
      row({ action: 'Tạo hồ sơ', fromStatus: null, toStatus: 'assigned', changes: null }),
    ]);
    expect(entry.detail).toBe('Đang cấp');
  });

  it('chuỗi rỗng trong changes không đẻ ra "lý do: " cụt lủn', () => {
    const [entry] = toIpHistoryEntries([row({ changes: { reason: '   ', usedBy: '' } })]);
    expect(entry.detail).not.toContain('lý do');
  });
});

describe('statusLabel', () => {
  it.each([
    ['free', 'Trống'],
    ['assigned', 'Đang cấp'],
    ['suspect_dead', 'Nghi chết'],
    ['reclaimed', 'Đã thu hồi'],
  ])('%s → %s', (status, expected) => {
    expect(statusLabel(status)).toBe(expected);
  });

  /** Trạng thái lạ (dữ liệu cũ, migration sau) giữ nguyên tên còn hơn hiện ô trống. */
  it('trạng thái lạ giữ nguyên, không nuốt mất', () => {
    expect(statusLabel('trang_thai_moi')).toBe('trang_thai_moi');
    expect(statusLabel(null)).toBe('—');
  });
});
