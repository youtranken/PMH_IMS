import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { toSoftwareHistory } from './software-history-entries';
import type { SoftwareHistoryRow } from './software-types';

/*
 * `t` truyền vào đây là `t` THẬT của app (`@/lib/i18n`, đã nạp bản dịch tiếng Việt), KHÔNG
 * phải một stub trả lại chính cái khóa.
 *
 * Đó là chỗ bài kiểm này đáng giá hơn trước: mọi câu khẳng định bên dưới so với CHỮ THẬT trên
 * màn hình, nên một khóa gõ sai hay một khóa quên khai trong `vi.ts` sẽ làm đỏ ngay tại đây —
 * đúng lớp lỗi của mục #1 bản rà soát (i18next rơi về chính cái khóa và không ai thấy).
 */
const t = i18n.t;

function row(over: Partial<SoftwareHistoryRow>): SoftwareHistoryRow {
  return {
    id: '1',
    action: 'updated',
    actor: 'it01@pmh.com.vn',
    changes: null,
    createdAt: '2026-08-23T02:00:00Z',
    ...over,
  };
}

describe('toSoftwareHistory — tab Lịch sử hồ sơ phần mềm phải đọc được', () => {
  it('gia hạn hiện rõ hạn cũ → hạn mới', () => {
    const [entry] = toSoftwareHistory([
      row({ action: 'renewed', changes: { endDate: { before: '2026-08-30', after: '2027-08-30' } } }),
    ], t);
    expect(entry.action).toBe('Gia hạn');
    expect(entry.detail).toBe('ngày hết hạn: 2026-08-30 → 2027-08-30');
  });

  it('loại và trạng thái hiện nhãn tiếng Việt, không phải mã máy', () => {
    const [entry] = toSoftwareHistory([
      row({ changes: { kind: { before: 'license', after: 'ssl' }, status: { before: 'active', after: 'retired' } } }),
    ], t);
    // 'Đã thanh lý' từ 23/09 — trước đó riêng `/software` gọi trạng thái này là 'Đã bỏ',
    // trong khi cùng hồ sơ ấy sang màn Kho thanh lý lại đọc 'Đã thanh lý'.
    expect(entry.detail).toBe(
      'loại: License phần mềm → Chứng chỉ SSL; trạng thái: Đang dùng → Đã thanh lý',
    );
  });

  it('nhà cung cấp chỉ nói "đổi", không phun uuid ra màn hình', () => {
    const [entry] = toSoftwareHistory([
      row({ changes: { vendorId: { before: 'aaa-111', after: 'bbb-222' } } }),
    ], t);
    expect(entry.detail).toBe('đổi nhà cung cấp');
  });

  it('giá trị rỗng hiện "(trống)"', () => {
    const [entry] = toSoftwareHistory([
      row({ changes: { seatTotal: { before: null, after: 10 } } }),
    ], t);
    expect(entry.detail).toBe('số seat: (trống) → 10');
  });

  /**
   * Sửa ghế (0027): một license 10 ghế thì "đổi chi phí" là vô nghĩa nếu không nói ghế nào.
   * Mã máy đi kèm dưới dạng trường KHÔNG đổi — hiện làm bối cảnh, không phải mũi tên.
   */
  it('sửa ghế license: nói rõ ghế nào, rồi mới tới cái đã đổi', () => {
    const [entry] = toSoftwareHistory([
      row({
        action: 'license-terms-updated',
        changes: {
          device: { before: 'PC-KT-01', after: 'PC-KT-01' },
          cost: { before: null, after: 3_500_000 },
          contract: { before: null, after: 'HD-2026-014' },
        },
      }),
    ], t);
    expect(entry.action).toBe('Sửa ghế license');
    expect(entry.detail).toBe(
      'ghế PC-KT-01; chi phí: (trống) → 3.500.000 ₫; hợp đồng: (trống) → HD-2026-014',
    );
  });

  it('gán và gỡ license hiện tên tiếng Việt, không phải mã hành động thô', () => {
    const [assigned] = toSoftwareHistory([row({ action: 'license-assigned' })], t);
    const [released] = toSoftwareHistory([row({ action: 'license-released' })], t);
    expect(assigned.action).toBe('Gán license vào máy');
    expect(released.action).toBe('Gỡ license khỏi máy');
  });

  it('chi phí hiện thành tiền đồng, không phải một dãy số trần', () => {
    const [entry] = toSoftwareHistory([
      row({ action: 'license-terms-updated', changes: { cost: { before: 0, after: 12_000_000 } } }),
    ], t);
    expect(entry.detail).toBe('chi phí: 0 ₫ → 12.000.000 ₫');
  });

  it('không có changes thì không bịa mô tả', () => {
    const [entry] = toSoftwareHistory([row({ action: 'created', changes: null })], t);
    expect(entry.action).toBe('Tạo hồ sơ');
    expect(entry.detail).toBeNull();
  });
});
