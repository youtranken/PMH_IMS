import type { ParsedSheets } from '../../common/import-plan';
import { ISP_SHEET, parseIspSheet } from './isp-import';

/** UX-E30: đọc sheet "Đường truyền" — đúng bộ cột của file Xuất (tham chiếu theo TÊN / MÃ). */
const sheet = (cells: Record<string, string>[]): ParsedSheets => ({
  [ISP_SHEET]: cells.map((c, i) => ({ rowNumber: i + 2, cells: c })),
});

describe('parseIspSheet', () => {
  it('đọc đủ cột của file Xuất; IP WAN nhiều IP trong một ô; trạng thái theo nhãn; hotline bỏ dấu trình bày', () => {
    const [row] = parseIspSheet(
      sheet([
        {
          'Mã': 'ISP-HCM-1',
          'Nhà mạng': 'FPT',
          'Tốc độ gói cước': '300 Mbps',
          'IP WAN': '203.113.1.5, 203.113.1.6',
          'Site': 'HCM',
          'Thiết bị': 'RT-HCM-01',
          'Hotline': '1900 6600',
          'Số hợp đồng': 'HĐ-01',
          'Bắt đầu': '2026-01-05',
          'Trạng thái': 'Tạm ngưng',
          'Ghi chú': 'Đường phụ',
        },
      ]),
    )!;
    expect(row).toEqual({
      rowNumber: 2,
      cells: {
        code: 'ISP-HCM-1',
        provider: 'FPT',
        bandwidth: '300 Mbps',
        wanIps: ['203.113.1.5', '203.113.1.6'],
        site: 'HCM',
        device: 'RT-HCM-01',
        hotline: '19006600',
        contractNo: 'HĐ-01',
        startDate: '2026-01-05',
        status: 'suspended',
        note: 'Đường phụ',
      },
    });
  });

  it.each([
    ['trạng thái lạ', { 'Mã': 'X', 'Trạng thái': 'Đang sửa' }, /Trạng thái/],
    ['hotline có chữ', { 'Mã': 'X', 'Hotline': 'gọi anh Tuấn' }, /Hotline/],
    ['ghi chú trông như mật khẩu', { 'Mã': 'X', 'Ghi chú': 'mk tạm Pmh@Guest2026 nhớ đổi' }, /mật khẩu/],
  ])('%s → dòng lỗi nêu cột', (_name, cells, message) => {
    const [row] = parseIspSheet(sheet([cells]))!;
    expect(row.error).toMatch(message);
    expect(row.cells).toBeUndefined();
  });

  it('không có sheet đúng tên → null', () => {
    expect(parseIspSheet({ 'Sheet1': [] })).toBeNull();
  });
});
