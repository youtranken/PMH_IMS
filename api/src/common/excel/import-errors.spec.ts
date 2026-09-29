import * as ExcelJS from 'exceljs';
import { ExcelExportService } from './excel-export.service';
import { buildImportErrorsXlsx, importErrorRows } from './import-errors';

/*
 * "Tải file lỗi" của hộp nhập Excel (ADM-005): file 300 dòng mà 12 dòng lỗi thì người sửa cần
 * một tờ liệt kê đúng 12 dòng đó — sheet nào, dòng số mấy, mục gì, vì sao — để mở file gốc ra
 * sửa, không phải chép tay từ bảng đối chiếu.
 */
describe('importErrorRows — chỉ giữ dòng lỗi, đúng thứ tự file', () => {
  it('bỏ dòng thêm/cập nhật/không đổi; giữ sheet, số dòng, mục, lý do', () => {
    expect(
      importErrorRows([
        { sheet: 'Site', rowNumber: 2, action: 'create', label: 'S1' },
        { sheet: 'Tủ mạng', rowNumber: 5, action: 'error', label: 'R01', message: 'Không có site "X".' },
        { sheet: 'Site', rowNumber: 3, action: 'error', label: 'S2' },
        { sheet: 'Site', rowNumber: 4, action: 'unchanged', label: 'S3' },
      ]),
    ).toEqual([
      { sheet: 'Tủ mạng', rowNumber: 5, label: 'R01', message: 'Không có site "X".' },
      { sheet: 'Site', rowNumber: 3, label: 'S2', message: '' },
    ]);
  });
});

describe('buildImportErrorsXlsx', () => {
  it('một sheet: Sheet · Dòng · Mục · Lý do, mỗi dòng lỗi một hàng', async () => {
    const buffer = await buildImportErrorsXlsx(new ExcelExportService(), [
      { sheet: 'Tủ mạng', rowNumber: 5, label: 'R01', message: 'Không có site "X".' },
      { sheet: 'Site', rowNumber: 3, label: '=HACK()', message: 'Thiếu tên.' },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0];
    const values = (row: number) => (sheet.getRow(row).values as unknown[]).slice(1);
    expect(values(1)).toEqual(['Sheet', 'Dòng', 'Mục', 'Lý do']);
    expect(values(2)).toEqual(['Tủ mạng', 5, 'R01', 'Không có site "X".']);
    // Nhãn lấy từ file người dùng gõ — vẫn phải qua `sanitize` chống chèn công thức.
    expect(values(3)).toEqual(['Site', 3, "'=HACK()", 'Thiếu tên.']);
  });
});
