import { ISP_EXPORT_COLUMNS } from './isp-line.controller';

/**
 * Q-04 (làm rõ): cột tốc độ là tốc độ của GÓI CƯỚC đường truyền, không phải thuộc tính của nhà
 * mạng — file Excel đọc cùng chữ với form.
 */
describe('ISP_EXPORT_COLUMNS', () => {
  it('bộ cột file Excel đường truyền', () => {
    expect(ISP_EXPORT_COLUMNS.map((c) => c.header)).toEqual([
      'Mã',
      'Nhà mạng',
      'Tốc độ gói cước',
      'IP WAN',
      'Site',
      'Thiết bị',
      'Hotline',
      'Số hợp đồng',
      'Bắt đầu',
      'Trạng thái',
      'Ghi chú',
    ]);
  });
});
