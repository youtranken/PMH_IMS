import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { toServiceAccountHistory } from './service-account-history-entries';
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
    { action: 'disabled', label: 'Vô hiệu hóa' },
    { action: 'enabled', label: 'Bật lại' },
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
        expected: 'trạng thái: Đang dùng → Đã vô hiệu',
      },
      // Chiều ngược lại cũng phải đọc được — bật lại là một dòng lịch sử ngang hàng với đóng.
      {
        name: 'bật lại: trạng thái đi ngược',
        changes: { status: { before: 'disabled', after: 'active' } },
        expected: 'trạng thái: Đã vô hiệu → Đang dùng',
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
});
