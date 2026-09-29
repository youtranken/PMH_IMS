import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { lastDisable, toServiceAccountHistory } from './service-account-history-entries';
import type { ServiceAccountHistoryRow } from './service-account-types';

/*
 * `t` truyền vào đây là `t` THẬT của app (`@/lib/i18n`, đã nạp bản dịch tiếng Việt), KHÔNG
 * phải một stub trả lại chính cái khóa.
 *
 * Đó là chỗ bài kiểm này đáng giá hơn trước: mọi câu khẳng định bên dưới so với CHỮ THẬT trên
 * màn hình, nên một khóa gõ sai hay một khóa quên khai trong `vi.ts` sẽ làm đỏ ngay tại đây —
 * đúng lớp lỗi của mục #1 bản rà soát (i18next rơi về chính cái khóa và không ai thấy).
 */
const t = i18n.t;

function row(over: Partial<ServiceAccountHistoryRow> = {}): ServiceAccountHistoryRow {
  return {
    id: 'h1',
    action: 'updated',
    actor: 'sa@pmh.com.vn',
    changes: null,
    createdAt: '2026-08-26T10:00:00Z',
    ...over,
  };
}

describe('toServiceAccountHistory — dịch lịch sử thô thành câu người đọc được', () => {
  const actions: { action: string; label: string }[] = [
    { action: 'created', label: 'Tạo hồ sơ' },
    { action: 'updated', label: 'Sửa hồ sơ' },
    { action: 'disabled', label: 'Ngừng dùng' },
    { action: 'enabled', label: 'Dùng lại' },
  ];

  for (const { action, label } of actions) {
    it(`"${action}" → "${label}"`, () => {
      expect(toServiceAccountHistory([row({ action })], t)[0].action).toBe(label);
    });
  }

  // Hành động chưa có nhãn thì hiện NGUYÊN mã, không hiện rỗng: người đọc còn biết đường hỏi.
  it('hành động lạ giữ nguyên mã thô', () => {
    expect(toServiceAccountHistory([row({ action: 'exported' })], t)[0].action).toBe('exported');
  });

  it('không có thay đổi thì detail là null', () => {
    expect(toServiceAccountHistory([row()], t)[0].detail).toBeNull();
  });

  const details: { name: string; changes: ServiceAccountHistoryRow['changes']; expected: string }[] =
    [
      {
        name: 'đổi tên đăng nhập',
        changes: { login: { before: 'ketoan@pmh.com.vn', after: 'ketoan2@pmh.com.vn' } },
        expected: 'tên đăng nhập: ketoan@pmh.com.vn → ketoan2@pmh.com.vn',
      },
      {
        name: 'loại dịch sang tiếng Việt',
        changes: { kind: { before: 'shared', after: 'vpn' } },
        expected: 'loại: Tài khoản dùng chung → Tài khoản VPN',
      },
      {
        name: 'trạng thái dịch sang tiếng Việt',
        changes: { status: { before: 'active', after: 'disabled' } },
        expected: 'trạng thái: Đang dùng → Đã ngừng dùng',
      },
      // Chiều ngược lại cũng phải đọc được — bật lại là một dòng lịch sử ngang hàng với đóng.
      {
        name: 'bật lại: trạng thái đi ngược',
        changes: { status: { before: 'disabled', after: 'active' } },
        expected: 'trạng thái: Đã ngừng dùng → Đang dùng',
      },
      // Ô rỗng phải đọc ra "(trống)" chứ không phải một khoảng trắng không ai thấy.
      {
        name: 'giá trị rỗng đọc ra (trống)',
        changes: { groupName: { before: null, after: 'vpn-ketoan' } },
        expected: 'nhóm VPN: (trống) → vpn-ketoan',
      },
      {
        name: 'nhiều thay đổi nối bằng dấu chấm phẩy',
        changes: {
          name: { before: 'A', after: 'B' },
          department: { before: 'Kế toán', after: 'Kỹ thuật' },
        },
        expected: 'tên: A → B; bộ phận: Kế toán → Kỹ thuật',
      },
      // Trường không đổi đi kèm chỉ để làm bối cảnh — "A → A" bắt người đọc dừng lại tìm xem
      // đã đổi gì.
      {
        name: 'trường không đổi hiện một lần, không vẽ mũi tên',
        changes: { code: { before: 'TK-KT', after: 'TK-KT' } },
        expected: 'mã TK-KT',
      },
      {
        name: 'lý do vô hiệu hóa hiện ra',
        changes: { reason: { before: null, after: 'Nhân sự nghỉ việc' } },
        expected: 'lý do: (trống) → Nhân sự nghỉ việc',
      },
    ];

  for (const { name, changes, expected } of details) {
    it(name, () => {
      expect(toServiceAccountHistory([row({ changes })], t)[0].detail).toBe(expected);
    });
  }

  it('giữ nguyên mốc thời gian và người làm', () => {
    const entry = toServiceAccountHistory([row()], t)[0];
    expect(entry.at).toBe('2026-08-26T10:00:00Z');
    expect(entry.actor).toBe('sa@pmh.com.vn');
  });

  it('dòng "Tạo hồ sơ" liệt kê giá trị ban đầu, không "(trống) →"', () => {
    const [entry] = toServiceAccountHistory(
      [
        row({
          action: 'created',
          changes: {
            code: { before: null, after: 'TK-KETOAN' },
            kind: { before: null, after: 'vpn' },
            note: { before: null, after: '' },
          },
        }),
      ],
      t,
    );
    expect(entry.detail).not.toContain('→');
    expect(entry.detail).toContain('TK-KETOAN');
  });

  it('người làm hiện bằng họ tên khi API tra được', () => {
    expect(toServiceAccountHistory([row({ actorName: 'Lê Minh' })], t)[0].actorName).toBe('Lê Minh');
  });
});

describe('lastDisable — ai vô hiệu hóa, lúc nào, vì sao', () => {
  const off = row({
    id: 'off',
    action: 'disabled',
    actor: 'sa@pmh.com.vn',
    actorName: 'Lê Minh',
    createdAt: '2026-09-20T02:00:00Z',
    changes: {
      status: { before: 'active', after: 'disabled' },
      reason: { before: null, after: 'Nhân viên đã nghỉ' },
    },
  });
  it('lấy lượt vô hiệu hóa MỚI NHẤT (API trả mới nhất trước)', () => {
    expect(lastDisable([off, row({ id: 'old', action: 'disabled' })])).toEqual({
      at: '2026-09-20T02:00:00Z',
      actor: 'Lê Minh',
      reason: 'Nhân viên đã nghỉ',
    });
  });
  it('bật lại sau đó thì lượt vô hiệu hóa cũ không còn là câu trả lời', () => {
    expect(lastDisable([row({ action: 'enabled' }), off])).toBeNull();
  });
  it('sổ rỗng', () => {
    expect(lastDisable([])).toBeNull();
  });
});
