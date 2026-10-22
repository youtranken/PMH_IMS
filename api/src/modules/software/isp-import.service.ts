import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DB, type Database } from '../../database/database.module';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { ExcelImportService } from '../../common/excel/excel-import.service';
import { buildImportErrorsXlsx, importErrorRows } from '../../common/excel/import-errors';
import { ISP_EXPORT_COLUMNS, ISP_SHEET, parseIspSheet } from './isp-import';
import { IspLineService, type IspImportPlan } from './isp-line.service';

/**
 * Nhập đường truyền từ Excel (UX-E30) — cùng khuôn với Tài khoản dịch vụ / Thiết bị: XEM TRƯỚC
 * rồi mới GHI, bước ghi đối chiếu LẠI từ chính file gửi lần hai.
 */
@Injectable()
export class IspImportService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly excelIn: ExcelImportService,
    private readonly excelOut: ExcelExportService,
    private readonly isp: IspLineService,
  ) {}

  /** File mẫu = mọi đường truyền (kể cả đã thanh lý), đúng bộ cột của file Xuất. */
  async template(): Promise<Buffer> {
    return this.excelOut.build({
      sheetName: ISP_SHEET,
      columns: ISP_EXPORT_COLUMNS,
      rows: await this.isp.listAll({ status: 'active,suspended,terminated' }),
    });
  }

  async preview(buffer: Buffer): Promise<IspImportPlan> {
    const parsed = parseIspSheet(await this.excelIn.read(buffer));
    if (parsed === null) {
      throw new BadRequestException({
        code: 'ISP_FILE_UNRECOGNIZED',
        message: `File không có sheet nào tên "${ISP_SHEET}". Hãy bấm "Tải file mẫu" và điền vào đó.`,
      });
    }
    return this.isp.planImport(parsed);
  }

  async errorsFile(buffer: Buffer): Promise<Buffer> {
    const plan = await this.preview(buffer);
    return buildImportErrorsXlsx(this.excelOut, importErrorRows(plan.rows.map((row) => ({ ...row, sheet: ISP_SHEET }))));
  }

  async commit(actor: string, buffer: Buffer): Promise<{ plan: IspImportPlan; created: number; updated: number }> {
    const plan = await this.preview(buffer);
    if (plan.summary.error > 0) {
      throw new BadRequestException({
        code: 'ISP_IMPORT_HAS_ERRORS',
        message: `Còn ${plan.summary.error} dòng lỗi — sửa trong file rồi tải lên lại. Chưa ghi gì cả.`,
      });
    }
    const counts = await this.db.transaction((tx) => this.isp.commitImportWithin(tx, actor, plan));
    return { plan, ...counts };
  }
}
