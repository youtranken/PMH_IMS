import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Phần HTTP dùng chung của mọi endpoint xlsx (AD-15): nhận file lên và gửi file về.
 *
 * Trước đây `catalog.controller` và `devices.controller` mỗi bên giữ một bản sao y hệt —
 * và đã kịp lệch nhau hai lần (trần dung lượng 5MB vs 10MB; một bên thêm header còn bên kia
 * quên). Đúng thứ AD-15 sinh ra để chặn.
 */

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Trần dung lượng file import. 10MB đủ cho vài nghìn dòng — file danh mục vài trăm dòng
 * và file thiết bị vài nghìn dòng dùng CHUNG một con số, không ai phải nhớ hai giá trị.
 */
export const XLSX_UPLOAD_LIMIT = { fileSize: 10 * 1024 * 1024 };

export const EXCEL_UNREADABLE_MESSAGE =
  'Không đọc được file — file có thể hỏng hoặc không phải Excel. Thử mở lại bằng Excel rồi lưu, hoặc tải file mẫu.';

/**
 * Chỉ nhận .xlsx. Kiểm bằng MAGIC BYTE (`PK\x03\x04`) chứ không tin Content-Type client gửi
 * (NFR-9); đuôi file là lớp thứ hai vì zip nào cũng mang magic đó.
 */
export function requireXlsx(file: Express.Multer.File | undefined): Buffer {
  if (!file?.buffer?.length) {
    throw new BadRequestException({
      code: 'FILE_REQUIRED',
      message: 'Chưa chọn file. Hãy tải file mẫu, điền rồi tải lên.',
    });
  }
  const isZip =
    file.buffer.length > 4 &&
    file.buffer[0] === 0x50 &&
    file.buffer[1] === 0x4b &&
    file.buffer[2] === 0x03 &&
    file.buffer[3] === 0x04;
  // multer/busboy đọc filename multipart theo latin1 — tên tiếng Việt thành mojibake
  // nếu không decode lại UTF-8.
  const name = Buffer.from(file.originalname, 'latin1').toString('utf8').toLowerCase();
  if (!name.endsWith('.xlsx')) {
    throw new BadRequestException({
      code: 'UNSUPPORTED_FILE',
      message: 'Chỉ nhận file .xlsx. File .xls thì mở bằng Excel rồi "Lưu thành" .xlsx.',
    });
  }
  /* Đúng đuôi mà không phải zip: file hỏng hoặc bị đổi đuôi. Cùng mã với lỗi đọc workbook
     (`excel-import.service`) — với người dùng đó là MỘT chuyện: file này không mở được. */
  if (!isZip) {
    throw new BadRequestException({
      code: 'EXCEL_UNREADABLE',
      message: EXCEL_UNREADABLE_MESSAGE,
    });
  }
  return file.buffer;
}

/**
 * Gửi workbook về dưới dạng tải xuống.
 *
 * KHÔNG set `X-Content-Type-Options` ở đây: helmet đặt cho mọi response và nginx đặt thêm
 * một lần nữa (`add_header … always`). Set lần thứ ba ra header trùng lặp
 * "nosniff, nosniff, nosniff" — hợp lệ theo HTTP nhưng vô nghĩa (E2E story 2.3 bắt được).
 */
export function sendXlsx(res: Response, buffer: Buffer, fileName: string): void {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  res.end(buffer);
}
