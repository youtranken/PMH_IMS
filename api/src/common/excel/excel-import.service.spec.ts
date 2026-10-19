import { BadRequestException } from '@nestjs/common';
import { crc32, deflateRawSync } from 'node:zlib';
import * as ExcelJS from 'exceljs';
import { ExcelImportService, MAX_ROWS_PER_SHEET, MAX_UNZIPPED_BYTES } from './excel-import.service';

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

/**
 * Zip tối thiểu dựng tay (DEFLATE), để làm file nén nhỏ mà giải nén ra rất lớn — đúng hình dạng
 * zip-bomb — mà không phải thêm thư viện zip chỉ cho test.
 */
function zip(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const packed = deflateRawSync(data);
    const nameBytes = Buffer.from(name, 'utf8');
    const head = (signature: number, size: number) => {
      const b = Buffer.alloc(size);
      b.writeUInt32LE(signature, 0);
      return b;
    };
    const local = head(0x04034b50, 30);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = head(0x02014b50, 46);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function handmadeXlsx(sheetXml: string): Buffer {
  const xml = (s: string) => Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${s}`, 'utf8');
  return zip([
    {
      name: '[Content_Types].xml',
      data: xml(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: xml(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Thiết bị" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetXml}</sheetData></worksheet>`),
    },
  ]);
}

const cell = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

describe('ExcelImportService.read — zip-bomb', () => {
  it('file dựng tay hợp lệ thì đọc được (chứng minh bộ dựng zip trong bài này đúng)', async () => {
    const sheets = await new ExcelImportService().read(
      handmadeXlsx(`<row r="1">${cell('A1', 'Mã thiết bị *')}</row><row r="2">${cell('A2', 'E2E-1')}</row>`),
    );
    expect(sheets['Thiết bị']).toEqual([{ rowNumber: 2, cells: { 'Mã thiết bị *': 'E2E-1' } }]);
  });

  it('file nén nhỏ nhưng giải nén vượt trần → 400 EXCEL_TOO_LARGE, không nạp vào RAM', async () => {
    const bombBytes = 110 * 1024 * 1024;
    const filler = 'a'.repeat(30_000);
    const rowCount = Math.ceil(bombBytes / filler.length);
    const rows = Array.from({ length: rowCount }, (_v, i) => `<row r="${i + 2}">${cell(`A${i + 2}`, filler)}</row>`).join('');
    const bomb = handmadeXlsx(`<row r="1">${cell('A1', 'Mã thiết bị *')}</row>${rows}`);
    expect(bomb.length).toBeLessThan(10 * 1024 * 1024);
    const body = await errorOf(new ExcelImportService().read(bomb));
    expect(body.code).toBe('EXCEL_TOO_LARGE');
    expect(MAX_UNZIPPED_BYTES).toBeLessThan(bombBytes);
  }, 120_000);

  it('mục lục zip khai GIAN dung lượng nhỏ vẫn bị chặn: đo bằng cách giải nén có trần, không tin số khai', async () => {
    const filler = 'a'.repeat(30_000);
    const rows = Array.from({ length: Math.ceil((110 * 1024 * 1024) / filler.length) }, (_v, i) => `<row r="${i + 2}">${cell(`A${i + 2}`, filler)}</row>`).join('');
    const bomb = handmadeXlsx(`<row r="1">${cell('A1', 'Mã thiết bị *')}</row>${rows}`);
    // Sửa mọi trường "dung lượng giải nén" (local header +22, central directory +24) thành 1 KB.
    for (let at = 0; at + 4 <= bomb.length; at += 1) {
      const sig = bomb.readUInt32LE(at);
      if (sig === 0x04034b50) bomb.writeUInt32LE(1024, at + 22);
      if (sig === 0x02014b50) bomb.writeUInt32LE(1024, at + 24);
    }
    const body = await errorOf(new ExcelImportService().read(bomb));
    expect(body.code).toBe('EXCEL_TOO_LARGE');
  }, 120_000);

  it('không phải zip (rác) vẫn là EXCEL_UNREADABLE như cũ', async () => {
    const body = await errorOf(new ExcelImportService().read(Buffer.from('không phải excel')));
    expect(body.code).toBe('EXCEL_UNREADABLE');
  });
});
