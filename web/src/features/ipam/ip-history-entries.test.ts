import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';

/*
 * `t` truyền vào đây là `t` THẬT của app (`@/lib/i18n`, đã nạp bản dịch tiếng Việt), KHÔNG
 * phải một stub trả lại chính cái khóa.
 *
 * Đó là chỗ bài kiểm này đáng giá: mọi câu khẳng định bên dưới so với CHỮ THẬT trên
 * màn hình, nên một khóa gõ sai hay một khóa quên khai trong `vi.ts` sẽ làm đỏ ngay tại đây —
 * đúng lớp lỗi i18next rơi về chính cái khóa mà không ai thấy.
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
    expect(entry.detail).toContain('Đang dùng → Trống');
    expect(entry.actor).toBe('it01@pmh.com.vn');
  });

  /**
   * Đây là câu mà lịch sử IP tồn tại để trả lời: "IP này từng là máy in kế toán".
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
    expect(entry.detail).toContain('Trống → Đang dùng');
    expect(entry.detail).toContain('cấp cho: Anh Hùng — Kho');
  });

  /**
   * `ip_history` là chỉ-thêm (AD-13) và giữ vĩnh viễn: dòng ghi từ hồi IP còn bốn trạng thái
   * vẫn mang `suspect_dead` / `reclaimed`, và vẫn phải đọc ra chữ, không phải khóa máy.
   */
  it.each([
    ['Đánh dấu nghi chết', 'assigned', 'suspect_dead', 'Đang dùng → Nghi chết'],
    ['Thu hồi', 'suspect_dead', 'reclaimed', 'Nghi chết → Đã thu hồi'],
    ['Cấp lại', 'reclaimed', 'assigned', 'Đã thu hồi → Đang dùng'],
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
    expect(entry.detail).toBe('Đang dùng');
  });

  /** AC 5.2 hỏi "IP này từng của MÁY NÀO" — API tra sẵn mã máy, dòng lịch sử phải nói ra. */
  it('thu hồi từ một MÁY: nói mã máy cũ, kèm người dùng cũ', () => {
    const [entry] = toIpHistoryEntries([
      row({
        previousDeviceCode: 'LT-E2E-01',
        changes: {
          previousDeviceId: 'dev-1',
          previousUsedBy: 'Nguyễn A',
          deviceId: null,
          usedBy: null,
        },
      }),
    ], t);
    expect(entry.detail).toContain('trước đó: LT-E2E-01 (Nguyễn A)');
  });

  it('cấp cho một máy: nói mã máy, kể cả khi không có người dùng', () => {
    const [entry] = toIpHistoryEntries([
      row({
        action: 'ip.created',
        fromStatus: null,
        toStatus: 'assigned',
        deviceCode: 'PRN-E2E-02',
        changes: { deviceId: 'dev-2', usedBy: null },
      }),
    ], t);
    expect(entry.detail).toContain('cấp cho: PRN-E2E-02');
  });

  it('người làm hiện bằng họ tên khi API tra được, email vẫn đi kèm', () => {
    const [named] = toIpHistoryEntries([row({ actorName: 'Lê Minh' })], t);
    expect(named.actorName).toBe('Lê Minh');
    expect(named.actor).toBe('it01@pmh.com.vn');
    const [unnamed] = toIpHistoryEntries([row()], t);
    expect(unnamed.actorName).toBeUndefined();
  });

  it('chuỗi rỗng trong changes không đẻ ra "lý do: " cụt lủn', () => {
    const [entry] = toIpHistoryEntries([row({ changes: { reason: '   ', usedBy: '' } })], t);
    expect(entry.detail).not.toContain('lý do');
  });
});

/**
 * Mọi hành động phải có tên tiếng Việt: thiếu nhãn thì bảng lịch sử xen kẽ hai thứ tiếng —
 * bước chuyển mang tên do API đặt ("Thu hồi"), còn hành động khác rơi ra nguyên khóa máy
 * ("ip.voided").
 */
describe('actionLabel — tên việc bằng tiếng Việt', () => {
  it.each([
    ['ip.created', 'Tạo hồ sơ'],
    ['ip.updated', 'Sửa hồ sơ'],
    ['ip.assigned', 'Cấp IP'],
    ['ip.voided', 'Xóa hồ sơ IP nhập nhầm'],
    ['ip.subnet_voided', 'Ngừng dùng theo dải'],
    ['ip.restored', 'Dùng lại'],
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
    expect(entry.action).toBe('Dùng lại');
  });

  /*
   * Dòng tắt-theo-dải ghi TRƯỚC khi có mã `ip.subnet_voided` mang mã `ip.voided` (kèm cả
   * `fromStatus` lẫn `toStatus`). `ip_history` chỉ-thêm (AD-13) nên không sửa dữ liệu cũ được —
   * đọc nó là "Xóa hồ sơ nhập nhầm" là nói sai về một hồ sơ vẫn sống lại khi dùng lại dải.
   */
  it('dòng cũ tắt theo dải đọc là Ngừng dùng theo dải, không phải Xóa', () => {
    const [legacy, deleted] = toIpHistoryEntries(
      [
        row({
          action: 'ip.voided',
          fromStatus: 'assigned',
          toStatus: 'assigned',
          changes: { reason: 'ẩn theo dải: khai nhầm' },
        }),
        row({
          action: 'ip.voided',
          fromStatus: 'assigned',
          toStatus: null,
          changes: { reason: 'gõ nhầm chủ' },
        }),
      ],
      t,
    );
    expect(legacy.action).toBe('Ngừng dùng theo dải');
    expect(deleted.action).toBe('Xóa hồ sơ IP nhập nhầm');
  });
});

describe('statusLabel', () => {
  it.each([
    ['free', 'Trống'],
    ['assigned', 'Đang dùng'],
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
