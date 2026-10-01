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

  it('nhiều IP WAN chung một ô, ngăn bằng dấu phẩy (Q-20)', () => {
    const wan = ISP_EXPORT_COLUMNS.find((c) => c.header === 'IP WAN')!;
    expect(wan.value({ wanIps: ['113.161.10.20', '113.161.10.21'] } as never)).toBe(
      '113.161.10.20, 113.161.10.21',
    );
    expect(wan.value({ wanIps: [] } as never)).toBe('');
  });
});
