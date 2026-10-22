import type { ParsedSheets } from '../../common/import-plan';
import { parseSoftwareSheets } from './software-import';

/**
 * UX-E30: đọc file Phần mềm — đúng bộ cột của file Xuất của bốn màn (Q-22): sheet "Phần mềm",
 * "Tên miền & SSL", "Hợp đồng bảo trì", "Dịch vụ có hạn khác". Cột vắng = giữ nguyên.
 */
const file = (sheet: string, cells: Record<string, string>[]): ParsedSheets => ({
  [sheet]: cells.map((c, i) => ({ rowNumber: i + 2, cells: c })),
});

describe('parseSoftwareSheets', () => {
  it('sheet Phần mềm: đọc đủ cột của file Xuất; "Ghế dùng/tổng" lấy số TỔNG; trạng thái bị bỏ qua', () => {
    const [row] = parseSoftwareSheets(
      file('Phần mềm', [
        {
          'Mã hồ sơ': 'LIC-OFFICE',
          'Tên': 'Office 365',
          'Loại': 'License',
          'Nhà cung cấp': 'Microsoft',
          'Ghế dùng/tổng': '3/10',
          'Bắt đầu': '2026-01-01',
          'Hết hạn': '2027-01-01',
          'Trạng thái': 'Đang dùng',
          'Ghi chú': 'Gói E3',
        },
      ]),
    )!;
    expect(row).toEqual({
      rowNumber: 2,
      sheet: 'Phần mềm',
      cells: {
        code: 'LIC-OFFICE',
        name: 'Office 365',
        kind: 'license',
        vendor: 'Microsoft',
        seatTotal: 10,
        startDate: '2026-01-01',
        endDate: '2027-01-01',
        note: 'Gói E3',
      },
    });
  });

  it.each([
    ['Hợp đồng bảo trì', 'maintenance'],
    ['Dịch vụ có hạn khác', 'other'],
    ['Phần mềm', 'license'],
  ])('sheet "%s" không có cột Loại → loại %s', (sheet, kind) => {
    const [row] = parseSoftwareSheets(file(sheet, [{ 'Mã hồ sơ': 'X-1', 'Tên': 'X' }]))!;
    expect(row.cells?.kind).toBe(kind);
  });

  it('Tên miền & SSL: tên miền nhiều giá trị một ô; ô Ghế trống = không giới hạn', () => {
    const [row] = parseSoftwareSheets(
      file('Tên miền & SSL', [{ 'Mã hồ sơ': 'SSL-1', 'Tên': 'SSL', 'Loại': 'Chứng chỉ SSL', 'Tên miền': 'pmh.com.vn, www.pmh.com.vn', 'Ghế dùng/tổng': '' }]),
    )!;
    expect(row.cells).toMatchObject({ kind: 'ssl', websites: ['pmh.com.vn', 'www.pmh.com.vn'], seatTotal: null });
  });

  it.each([
    ['loại lạ', { 'Mã hồ sơ': 'X', 'Loại': 'Phần cứng' }, /Loại/],
    ['ghế không phải số', { 'Mã hồ sơ': 'X', 'Ghế dùng/tổng': 'mười' }, /Ghế/],
    ['ghi chú trông như mật khẩu', { 'Mã hồ sơ': 'X', 'Ghi chú': 'Key VK7JG-NPHTM-C97JM-9MPGT-3V66T' }, /mật khẩu/],
  ])('%s → dòng lỗi nêu cột', (_name, cells, message) => {
    const [row] = parseSoftwareSheets(file('Phần mềm', [cells]))!;
    expect(row.error).toMatch(message);
  });

  it('không có sheet nào trong bốn tên → null', () => {
    expect(parseSoftwareSheets({ 'Sheet1': [] })).toBeNull();
  });
});
