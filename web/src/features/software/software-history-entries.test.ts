import { describe, expect, it } from 'vitest';
import { toSoftwareHistory } from './software-history-entries';
import type { SoftwareHistoryRow } from './software-types';

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
    ]);
    expect(entry.action).toBe('Gia hạn');
    expect(entry.detail).toBe('ngày hết hạn: 2026-08-30 → 2027-08-30');
  });

  it('loại và trạng thái hiện nhãn tiếng Việt, không phải mã máy', () => {
    const [entry] = toSoftwareHistory([
      row({ changes: { kind: { before: 'license', after: 'ssl' }, status: { before: 'active', after: 'retired' } } }),
    ]);
    expect(entry.detail).toBe(
      'loại: License phần mềm → Chứng chỉ SSL; trạng thái: Đang dùng → Đã bỏ',
    );
  });

  it('nhà cung cấp chỉ nói "đổi", không phun uuid ra màn hình', () => {
    const [entry] = toSoftwareHistory([
      row({ changes: { vendorId: { before: 'aaa-111', after: 'bbb-222' } } }),
    ]);
    expect(entry.detail).toBe('đổi nhà cung cấp');
  });

  it('giá trị rỗng hiện "(trống)"', () => {
    const [entry] = toSoftwareHistory([
      row({ changes: { seatTotal: { before: null, after: 10 } } }),
    ]);
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
    ]);
    expect(entry.action).toBe('Sửa ghế license');
    expect(entry.detail).toBe(
      'ghế PC-KT-01; chi phí: (trống) → 3.500.000 ₫; hợp đồng: (trống) → HD-2026-014',
    );
  });

  it('gán và gỡ license hiện tên tiếng Việt, không phải mã hành động thô', () => {
    const [assigned] = toSoftwareHistory([row({ action: 'license-assigned' })]);
    const [released] = toSoftwareHistory([row({ action: 'license-released' })]);
    expect(assigned.action).toBe('Gán license vào máy');
    expect(released.action).toBe('Gỡ license khỏi máy');
  });

  it('chi phí hiện thành tiền đồng, không phải một dãy số trần', () => {
    const [entry] = toSoftwareHistory([
      row({ action: 'license-terms-updated', changes: { cost: { before: 0, after: 12_000_000 } } }),
    ]);
    expect(entry.detail).toBe('chi phí: 0 ₫ → 12.000.000 ₫');
  });

  it('không có changes thì không bịa mô tả', () => {
    const [entry] = toSoftwareHistory([row({ action: 'created', changes: null })]);
    expect(entry.action).toBe('Tạo hồ sơ');
    expect(entry.detail).toBeNull();
  });
});
