import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

export interface ExportColumn<T> {
  header: string;
  /** Lấy giá trị hiển thị từ một hàng. Trả về string|number|Date|null. */
  value: (row: T) => string | number | Date | null;
  width?: number;
}

/**
 * FR-028: xuất xlsx từ MỌI bảng đang xem — AD-15: viết MỘT LẦN ở đây.
 * Module nghiệp vụ chỉ khai cột + đưa mảng dữ liệu, KHÔNG tự import exceljs.
 * (Bài học QLTS: `asset-export.service.ts` nằm trong module assets, không tái dùng
 *  được và còn JOIN sang bảng module khác — IMS cấm lặp lại, xem AD-3.)
 */
@Injectable()
export class ExcelExportService {
  async build<T>(params: {
    sheetName: string;
    columns: ExportColumn<T>[];
    rows: T[];
  }): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.created = new Date();
    const sheet = wb.addWorksheet(params.sheetName.slice(0, 31));

    sheet.columns = params.columns.map((c) => ({
      header: c.header,
      key: c.header,
      width: c.width ?? Math.min(40, Math.max(12, c.header.length + 4)),
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const row of params.rows) {
      sheet.addRow(params.columns.map((c) => sanitize(c.value(row))));
    }
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: params.columns.length },
    };

    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
  }
}

/**
 * Chặn CSV/Excel formula injection: ô bắt đầu bằng = + - @ bị Excel coi là công thức.
 * Thêm dấu nháy đơn ở đầu để Excel hiểu là text.
 */
export function sanitize(
  value: string | number | Date | null,
): string | number | Date | null {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
