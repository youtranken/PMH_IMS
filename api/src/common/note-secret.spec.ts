import { noteContainsSecret, noteLooksLikeSecret } from './note-secret';

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

/**
 * Ghi chú có một "từ" trông như mật khẩu: dài >= 10, >= 3 nhóm ký tự, không lặp lại vô nghĩa.
 * Nửa dưới của bảng quan trọng ngang nửa trên: chặn nhầm ghi chú bình thường thì người dùng
 * học cách viết lách luật, và mật khẩu thật lọt qua bằng đúng cách viết ấy.
 */
describe('noteLooksLikeSecret', () => {
  const cases: [string, string | null, boolean][] = [
    // [ghi chú, bị chặn]
    ['Admin@123456', true],
    ['mật khẩu tạm P@ssw0rd!2026 đổi sau', true],
    ['Cisco#Core2026!', true],
    ['Matkhau2026', true],
    ['matkhau-2026!', true],
    ['Xk9#mP2vLq', true],
    ['https://admin:S3cret#Pass@10.0.0.1/login', true],
    ['Admin@1212', true],
    ['mk: Admin@123456.', true],
    ['API https://portal.example.vn/api?user=it&key=Ab12Cd34Ef56Gh', true],
    ['Ghi đè: SW-Core01.PMH.local mật khẩu Cisco#Core2026!', true],
    // Không được chặn.
    ['Mật khẩu đổi theo chu kỳ 90 ngày', false],
    ['IP quản trị 10.0.0.1', false],
    ['Model FortiGate 60F', false],
    ['Model WS-C2960X-48TS-L, serial FOC1234X0AB', false],
    ['Trang quản trị https://10.0.0.1:8443/Admin/Login?id=5', false],
    ['Hỗ trợ: Support.IT2026@pmh.com.vn', false],
    ['Hết hạn 30/09/2026, gia hạn trước 2026-10-15T08:00', false],
    ['Máy chủ SW-Core01.PMH.local cổng Gi1/0/24', false],
    ['MAC AA:BB:CC:11:22:33, VLAN 10/20/30', false],
    ['Ghi chú: gọi anh Nam 0903 123 456 khi cần reset', false],
    ['Aaaaaaaaa1!', false],
    ['Serial FGT60FTK2109ABCD', false],
    ['Đổi-mật-khẩu-sau', false],
    ['', false],
    [null, false],
  ];

  it.each(cases)('%s', (note, blocked) => {
    expect(noteLooksLikeSecret(note)).toBe(blocked);
  });
});
