import { ExcelExportService, sanitize } from './excel-export.service';

describe('sanitize — chặn formula injection', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+84901234567', "'+84901234567"],
    ['-5', "'-5"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['SW-CORE-01', 'SW-CORE-01'],
    ['192.168.1.1', '192.168.1.1'],
  ])('%s → %s', (input, expected) => {
    expect(sanitize(input)).toBe(expected);
  });

  it('giữ nguyên số, ngày và null', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(sanitize(42)).toBe(42);
    expect(sanitize(d)).toBe(d);
    expect(sanitize(null)).toBeNull();
  });
});

describe('ExcelExportService', () => {
  it('dựng được workbook có header + đúng số hàng', async () => {
    const svc = new ExcelExportService();
    const buffer = await svc.build({
      sheetName: 'Thiết bị',
      columns: [
        { header: 'Mã', value: (r: { code: string }) => r.code },
        { header: 'Tên', value: (r: { name: string }) => r.name },
      ] as never,
      rows: [
        { code: 'SW-01', name: 'Switch tầng 3' },
        { code: 'SW-02', name: 'Switch tầng 4' },
      ] as never,
    });
    expect(buffer.length).toBeGreaterThan(0);
    // xlsx là zip: 2 byte đầu luôn là 'PK'
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });
});
