import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ExcelImportService, MAX_ROWS_PER_SHEET } from './excel-import.service';

async function workbook(rows: ExcelJS.CellValue[][], sheetName = 'Thiết bị'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function errorOf(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BadRequestException);
  return (error as BadRequestException).getResponse() as { code: string; message: string };
}

describe('ExcelImportService.read — trần số dòng (BE-12)', () => {
  const header = ['Mã thiết bị *', 'Tên thiết bị *'];
  const dataRows = (n: number) => Array.from({ length: n }, (_v, i) => [`E2E-${i}`, 'x']);

  it('đúng trần thì đọc đủ, không cắt dòng nào', async () => {
    const sheets = await new ExcelImportService().read(
      await workbook([header, ...dataRows(MAX_ROWS_PER_SHEET)]),
    );
    expect(sheets['Thiết bị']).toHaveLength(MAX_ROWS_PER_SHEET);
  }, 60_000);

  it('vượt trần thì từ chối cả file bằng 400 nêu rõ trần, không cắt im lặng', async () => {
    const body = await errorOf(
      new ExcelImportService().read(await workbook([header, ...dataRows(MAX_ROWS_PER_SHEET + 1)])),
    );
    expect(body.code).toBe('EXCEL_TOO_MANY_ROWS');
    expect(body.message).toContain('Thiết bị');
    expect(body.message).toContain('20.000');
  }, 60_000);
});

describe('ExcelImportService.read — ô không đọc được giá trị (BE-12)', () => {
  const header = ['Mã', 'A', 'B', 'C', 'D', 'E'];

  it.each<[string, ExcelJS.CellValue, string, string | undefined]>([
    ['chuỗi thường', 'abc', 'abc', undefined],
    ['công thức có giá trị tính sẵn', { formula: '2+2', result: 4 }, '4', undefined],
    ['công thức KHÔNG có giá trị tính sẵn', { formula: '1+1' }, '', 'công thức'],
    ['ô lỗi #N/A', { error: '#N/A' }, '', '#N/A'],
    [
      'công thức ra lỗi #REF!',
      { formula: 'A1', result: { error: '#REF!' } },
      '',
      '#REF!',
    ],
  ])('%s', async (_name, value, text, problem) => {
    const sheets = await new ExcelImportService().read(
      await workbook([header, ['E2E-1', value]]),
    );
    const [row] = sheets['Thiết bị'];
    expect(row.cells.A).toBe(text);
    if (problem === undefined) {
      expect(row.unreadable?.A).toBeUndefined();
    } else {
      expect(row.unreadable?.A).toContain(problem);
    }
    expect(row.unreadable?.['Mã']).toBeUndefined();
  });
});
