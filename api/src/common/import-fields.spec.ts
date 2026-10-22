import { readImportFields, type ImportField } from './import-fields';

/** Đọc ô của file nhập (UX-E30) — dùng chung cho Tài khoản dịch vụ, Đường truyền, Phần mềm. */
describe('readImportFields', () => {
  const FIELDS: ImportField<'code' | 'ips' | 'start' | 'note'>[] = [
    { key: 'code', label: 'Mã', max: 5 },
    { key: 'ips', label: 'IP WAN', kind: 'list' },
    { key: 'start', label: 'Bắt đầu', kind: 'date' },
    { key: 'note', label: 'Ghi chú', noSecret: true },
  ];
  const row = (cells: Record<string, string>) => ({ rowNumber: 2, cells });

  it('vắng cột = vắng khóa; có cột trống = rỗng; danh sách tách phẩy / chấm phẩy / xuống dòng; ngày về ISO', () => {
    expect(readImportFields(row({ 'mã ': 'A1', 'IP WAN': '1.1.1.1, 2.2.2.2;\n3.3.3.3', 'Bắt đầu': '05/01/2026' }), FIELDS)).toEqual({
      cells: { code: 'A1', ips: ['1.1.1.1', '2.2.2.2', '3.3.3.3'], start: '2026-01-05' },
      error: null,
    });
    expect(readImportFields(row({ 'IP WAN': '', 'Bắt đầu': '' }), FIELDS).cells).toEqual({ ips: [], start: '' });
  });

  it.each([
    [{ 'Mã': 'QUA-DAI' }, /Mã.*dài quá 5/],
    [{ 'Bắt đầu': '31/02/2026' }, /Bắt đầu.*ngày có thật/],
    [{ 'Ghi chú': 'mk tạm Pmh@Guest2026 nhớ đổi' }, /mật khẩu/],
  ])('%j → lỗi nêu cột', (cells, message) => {
    const read = readImportFields(row(cells), FIELDS);
    expect(read.error).toMatch(message);
    expect(JSON.stringify(read)).not.toContain('Pmh@Guest2026');
  });
});
