import { describe, expect, it } from 'vitest';
import { toHistoryEntries } from './device-history-entries';
import type { DeviceHistoryRow } from './device-types';

function row(over: Partial<DeviceHistoryRow>): DeviceHistoryRow {
  return {
    id: '1',
    action: 'updated',
    actor: 'it01@pmh.com.vn',
    changes: null,
    createdAt: '2026-08-22T02:00:00Z',
    ...over,
  };
}

describe('toHistoryEntries — tab Lịch sử phải ĐỌC ĐƯỢC (FR-007)', () => {
  it('đổi hạn bảo hành hiện rõ giá trị cũ → mới', () => {
    const [entry] = toHistoryEntries([
      row({ changes: { warrantyEnd: { before: '2026-08-30', after: '2027-08-30' } } }),
    ]);
    expect(entry.action).toBe('Sửa hồ sơ');
    expect(entry.detail).toBe('bảo hành đến: 2026-08-30 → 2027-08-30');
  });

  it('giá trị rỗng hiện "(trống)" chứ không phải null', () => {
    const [entry] = toHistoryEntries([
      row({ changes: { serial: { before: null, after: 'FOC1234' } } }),
    ]);
    expect(entry.detail).toBe('serial: (trống) → FOC1234');
  });

  it('trạng thái hiện nhãn tiếng Việt, không phải mã máy', () => {
    const [entry] = toHistoryEntries([
      row({ action: 'status-changed', changes: { status: { before: 'in_use', after: 'retired' } } }),
    ]);
    expect(entry.action).toBe('Đổi trạng thái');
    expect(entry.detail).toBe('trạng thái: Đang dùng → Đã thanh lý');
  });

  it('trường tham chiếu danh mục chỉ nói "đổi …", không phun uuid ra màn hình', () => {
    const [entry] = toHistoryEntries([
      row({
        changes: {
          cabinetId: {
            before: '11111111-1111-1111-1111-111111111111',
            after: '22222222-2222-2222-2222-222222222222',
          },
        },
      }),
    ]);
    expect(entry.detail).toBe('đổi tủ mạng');
  });

  it('nhiều trường trong một lần sửa gộp chung một dòng', () => {
    const [entry] = toHistoryEntries([
      row({
        changes: {
          assignedTo: { before: 'anh Nam', after: 'chị Lan' },
          department: { before: null, after: 'Kế toán' },
        },
      }),
    ]);
    expect(entry.detail).toBe(
      'người sử dụng: anh Nam → chị Lan; bộ phận: (trống) → Kế toán',
    );
  });

  it('không có changes thì không bịa ra mô tả', () => {
    const [entry] = toHistoryEntries([row({ action: 'created', changes: null })]);
    expect(entry.action).toBe('Tạo hồ sơ');
    expect(entry.detail).toBeNull();
  });

  it('hành động lạ giữ nguyên tên thay vì hiện chuỗi rỗng', () => {
    const [entry] = toHistoryEntries([row({ action: 'thao-tac-moi' })]);
    expect(entry.action).toBe('thao-tac-moi');
  });
});
