import { BadRequestException } from '@nestjs/common';
import { requireXlsx } from './xlsx-http';

/**
 * Hai lỗi khác nhau, hai câu khác nhau: sai ĐUÔI thì bảo đổi sang .xlsx; đúng đuôi mà nội dung
 * không phải Excel (file hỏng) thì bảo "không đọc được". Nói "chỉ nhận .xlsx" với người vừa
 * gửi đúng file .xlsx là câu sai, họ không biết phải làm gì tiếp.
 */
function codeOf(name: string, bytes: number[]): string | undefined {
  try {
    requireXlsx({ originalname: name, buffer: Buffer.from(bytes) } as Express.Multer.File);
    return undefined;
  } catch (error) {
    const body = (error as BadRequestException).getResponse() as { code: string };
    return body.code;
  }
}

const ZIP = [0x50, 0x4b, 0x03, 0x04, 0x00, 0x00];
const JUNK = [0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x21];

describe('requireXlsx — phân biệt sai đuôi với file hỏng', () => {
  it.each([
    ['đúng đuôi, đúng zip → nhận', 'thiet-bi.xlsx', ZIP, undefined],
    ['sai đuôi (.xls) → UNSUPPORTED_FILE', 'cu.xls', JUNK, 'UNSUPPORTED_FILE'],
    ['sai đuôi dù là zip → UNSUPPORTED_FILE', 'nen.zip', ZIP, 'UNSUPPORTED_FILE'],
    ['đúng đuôi .xlsx nhưng nội dung hỏng → EXCEL_UNREADABLE', 'hong.xlsx', JUNK, 'EXCEL_UNREADABLE'],
  ])('%s', (_label, name, bytes, expected) => {
    expect(codeOf(name, bytes)).toBe(expected);
  });
});
