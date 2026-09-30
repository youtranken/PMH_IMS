import { noteContainsSecret } from './note-secret';

/**
 * Ghi chú của ngăn két là cột KHÔNG mã hoá, ai xem được danh sách là đọc được nó. Nên ghi chú
 * chứa chính giá trị vừa cất là một bản sao dạng rõ của bí mật (Q-18, FR-035).
 */
describe('noteContainsSecret', () => {
  const cases: [string, string | null, string, boolean][] = [
    // [mô tả, ghi chú, giá trị, bị chặn]
    ['ghi chú y hệt giá trị', 'Cisco#Core2026!', 'Cisco#Core2026!', true],
    ['khác hoa-thường vẫn là một', 'cisco#core2026!', 'Cisco#Core2026!', true],
    ['chèn dấu cách vẫn là một', 'Cisco # Core 2026 !', 'Cisco#Core2026!', true],
    ['giá trị nằm giữa câu', 'mk tạm là Cisco#Core2026! nhớ đổi', 'Cisco#Core2026!', true],
    ['giá trị ngắn trùng khớp nguyên ghi chú', 'abc', 'ABC', true],
    ['giá trị 6 ký tự nằm trong câu', 'mật khẩu 123456 nhé', '123456', true],
    ['giá trị 5 ký tự nằm trong câu: không chặn (quá dễ trùng chữ thường)', 'admin web cổng', 'admin', false],
    ['ghi chú bình thường', 'Đổi theo chu kỳ 90 ngày', 'Cisco#Core2026!', false],
    ['ghi chú trống', '', 'Cisco#Core2026!', false],
    ['không có ghi chú', null, 'Cisco#Core2026!', false],
    ['giá trị chỉ có khoảng trắng', 'ghi chú', '   ', false],
  ];

  it.each(cases)('%s', (_label, note, value, blocked) => {
    expect(noteContainsSecret(note, value)).toBe(blocked);
  });
});
