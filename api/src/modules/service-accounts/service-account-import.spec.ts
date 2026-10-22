import type { ParsedSheets } from '../../common/import-plan';
import { parseServiceAccountSheet, SERVICE_ACCOUNT_SHEET } from './service-account-import';

/**
 * UX-E30: đọc sheet "Tài khoản dịch vụ" — đúng bộ cột của file Xuất, để xuất ra sửa rồi nhập
 * lại được. Phần này chỉ ĐỌC ô; luật nghiệp vụ (ghép, kiểm) là `prepare()` của service.
 */
const sheet = (cells: Record<string, string>[]): ParsedSheets => ({
  [SERVICE_ACCOUNT_SHEET]: cells.map((c, i) => ({ rowNumber: i + 2, cells: c })),
});

describe('parseServiceAccountSheet', () => {
  it('đọc đủ cột của file Xuất; loại theo nhãn; trạng thái bị bỏ qua', () => {
    const rows = parseServiceAccountSheet(
      sheet([
        {
          'Mã': 'VPN-AN',
          'Tên': 'VPN An',
          'Loại': 'VPN',
          'Tên đăng nhập': 'an@pmh.com.vn',
          'Phòng ban': 'IT',
          'Người phụ trách': 'An',
          'Nhóm VPN': 'Ngoài giờ',
          'Dải IP được phép': '10.0.0.0/24',
          'Trạng thái': 'Đã ngừng dùng',
          'Hết hạn': '2027-01-31',
          'Ghi chú': 'Cấp tạm',
        },
      ]),
    );
    expect(rows).toEqual([
      {
        rowNumber: 2,
        input: {
          code: 'VPN-AN',
          name: 'VPN An',
          kind: 'vpn',
          login: 'an@pmh.com.vn',
          department: 'IT',
          ownerName: 'An',
          groupName: 'Ngoài giờ',
          allowedIps: '10.0.0.0/24',
          endDate: '2027-01-31',
          note: 'Cấp tạm',
        },
      },
    ]);
  });

  it.each([
    ['loại lạ', { 'Mã': 'X', 'Loại': 'Máy in' }, /Loại/],
    ['ngày hết hạn không đọc được', { 'Mã': 'X', 'Loại': 'VPN', 'Hết hạn': '31/02/2027x' }, /Hết hạn/],
    ['ghi chú trông như mật khẩu', { 'Mã': 'X', 'Loại': 'Dùng chung', 'Ghi chú': 'mk tạm Pmh@Guest2026 nhớ đổi' }, /mật khẩu/],
    ['mã dài quá 64', { 'Mã': 'X'.repeat(65), 'Loại': 'VPN' }, /Mã/],
  ])('%s → dòng lỗi nêu cột', (_name, cells, message) => {
    const [row] = parseServiceAccountSheet(sheet([cells]))!;
    expect(row.error).toMatch(message);
    expect(row.input).toBeUndefined();
  });

  it('dòng trống và dòng ví dụ bị bỏ; không có sheet đúng tên → null', () => {
    expect(parseServiceAccountSheet(sheet([{ 'Mã': '', 'Tên': '' }, { 'Mã': 'VD', 'Ghi chú nhập': 'Ví dụ' }]))).toEqual([]);
    expect(parseServiceAccountSheet({ 'Khác': [] })).toBeNull();
  });

  it('không có cột Loại → để trống loại (service lấy loại đang có khi sửa)', () => {
    const [row] = parseServiceAccountSheet(sheet([{ 'Mã': 'TK-1', 'Tên': 'A' }]))!;
    expect(row.input).toMatchObject({ code: 'TK-1' });
    expect(row.input?.kind).toBeUndefined();
  });
});
