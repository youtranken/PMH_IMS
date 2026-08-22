import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

export interface ExportColumn<T> {
  header: string;
  /** Lấy giá trị hiển thị từ một hàng. Trả về string|number|Date|null. */
  value: (row: T) => string | number | Date | null;
  width?: number;
}

export interface ExportSheet<T> {
  name: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /**
   * Dòng minh họa trong file MẪU: in chữ xám nghiêng để người dùng nhìn là biết
   * không phải dữ liệu thật (bước import cũng bỏ qua dòng này).
   */
  isExample?: (row: T) => boolean;
  /** Bỏ autoFilter cho sheet dạng văn bản (vd sheet Hướng dẫn). */
  noFilter?: boolean;
}

/**
 * FR-028: xuất xlsx từ MỌI bảng đang xem — AD-15: viết MỘT LẦN ở đây.
 * Module nghiệp vụ chỉ khai cột + đưa mảng dữ liệu, KHÔNG tự import exceljs.
 * (Bài học QLTS: `asset-export.service.ts` nằm trong module assets, không tái dùng
 *  được và còn JOIN sang bảng module khác — IMS cấm lặp lại, xem AD-3.)
 */
@Injectable()
export class ExcelExportService {
  /** Một bảng = một sheet (trường hợp thường gặp nhất). */
  build<T>(params: {
    sheetName: string;
    columns: ExportColumn<T>[];
    rows: T[];
  }): Promise<Buffer> {
    return this.buildWorkbook([
      { name: params.sheetName, columns: params.columns, rows: params.rows },
    ]);
  }

  /**
   * Nhiều sheet trong một file — file MẪU khai báo danh mục (story 2.1) cần
   * Hướng dẫn + Site + Tủ mạng + Loại thiết bị + Nhà cung cấp trong cùng một workbook.
   * `any` ở chữ ký để một workbook chứa được các sheet có kiểu dòng KHÁC NHAU
   * (mỗi sheet tự khai cột khớp kiểu của chính nó).
   */
  async buildWorkbook(sheets: ExportSheet<any>[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'IMS — PMH';
    wb.created = new Date();

    for (const spec of sheets) {
      const sheet = wb.addWorksheet(spec.name.slice(0, 31), {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      sheet.columns = spec.columns.map((c) => ({
        header: c.header,
        key: c.header,
        width: c.width ?? Math.min(40, Math.max(12, c.header.length + 4)),
      }));
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };

      for (const row of spec.rows) {
        const added = sheet.addRow(spec.columns.map((c) => sanitize(c.value(row))));
        if (spec.isExample?.(row)) {
          added.font = { italic: true, color: { argb: 'FF8A908A' } };
        }
      }

      if (!spec.noFilter && spec.columns.length > 0) {
        sheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: 1, column: spec.columns.length },
        };
      }
    }

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
