import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { toHistoryEntries } from './device-history-entries';
import type { DeviceHistoryRow } from '@/lib/device-types';

/*
 * `t` truyền vào đây là `t` THẬT của app (`@/lib/i18n`, đã nạp bản dịch tiếng Việt), KHÔNG
 * phải một stub trả lại chính cái khóa.
 *
 * Đó là chỗ bài kiểm này đáng giá hơn trước: mọi câu khẳng định bên dưới so với CHỮ THẬT trên
 * màn hình, nên một khóa gõ sai hay một khóa quên khai trong `vi.ts` sẽ làm đỏ ngay tại đây —
 * đúng lớp lỗi của mục #1 bản rà soát (i18next rơi về chính cái khóa và không ai thấy).
 */
const t = i18n.t;

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
    ], t);
    expect(entry.action).toBe('Sửa hồ sơ');
    expect(entry.detail).toBe('bảo hành đến: 2026-08-30 → 2027-08-30');
  });

  it('giá trị rỗng hiện "(trống)" chứ không phải null', () => {
    const [entry] = toHistoryEntries([
      row({ changes: { serial: { before: null, after: 'FOC1234' } } }),
    ], t);
    expect(entry.detail).toBe('serial: (trống) → FOC1234');
  });

  it('trạng thái hiện nhãn tiếng Việt, không phải mã máy', () => {
    const [entry] = toHistoryEntries([
      row({ action: 'status-changed', changes: { status: { before: 'in_use', after: 'retired' } } }),
    ], t);
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
    ], t);
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
    ], t);
    expect(entry.detail).toBe(
      'người sử dụng: anh Nam → chị Lan; bộ phận: (trống) → Kế toán',
    );
  });

  it('không có changes thì không bịa ra mô tả', () => {
    const [entry] = toHistoryEntries([row({ action: 'created', changes: null })], t);
    expect(entry.action).toBe('Tạo hồ sơ');
    expect(entry.detail).toBeNull();
  });

  it('hành động lạ giữ nguyên tên thay vì hiện chuỗi rỗng', () => {
    const [entry] = toHistoryEntries([row({ action: 'thao-tac-moi' })], t);
    expect(entry.action).toBe('thao-tac-moi');
  });
});

describe('toHistoryEntries — câu tự nhiên, không phải khoá thô', () => {
  it('tạo hồ sơ: không liệt kê "(trống) → …" cho từng ô', () => {
    const [entry] = toHistoryEntries([
      row({ action: 'created', changes: { code: { before: null, after: 'SW-01' } } }),
    ], t);
    expect(entry.action).toBe('Tạo hồ sơ');
    expect(entry.detail).toBeNull();
  });

  it('thêm / xóa cổng nói tên cổng ngay trong câu', () => {
    const [added, removed] = toHistoryEntries([
      row({ action: 'port-added', changes: { portLabel: { before: null, after: 'Gi1/0/10' } } }),
      row({ id: '2', action: 'port-removed', changes: { portLabel: { before: 'WAN1', after: null } } }),
    ], t);
    expect(added.action).toBe('Thêm cổng Gi1/0/10');
    expect(added.detail).toBeNull();
    expect(removed.action).toBe('Xóa cổng WAN1');
  });

  it('thanh lý kèm dọn: nói "đã gỡ IP, NAT, license", không phải "cleanup: (trống) → true"', () => {
    const [entry] = toHistoryEntries([
      row({
        action: 'status-changed',
        changes: {
          status: { before: 'in_use', after: 'retired' },
          cleanup: { before: null, after: true },
        },
      }),
    ], t);
    expect(entry.detail).toBe('trạng thái: Đang dùng → Đã thanh lý; đã gỡ IP, NAT và license của máy');
  });
});

describe('toHistoryEntries — người làm (DEV-085)', () => {
  it('hiện họ tên khi API tra được, email vẫn giữ cho tooltip', () => {
    const [entry] = toHistoryEntries([row({ actorName: 'Lê Minh' })], i18n.t);
    expect(entry.actorName).toBe('Lê Minh');
    expect(entry.actor).toBe('it01@pmh.com.vn');
  });

  it('không tra được thì để trống tên — panel lùi về email', () => {
    const [entry] = toHistoryEntries([row({ actorName: null })], i18n.t);
    expect(entry.actorName).toBeUndefined();
  });
});
