import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DB, type Database } from '../../database/database.module';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { ExcelImportService } from '../../common/excel/excel-import.service';
import { buildImportErrorsXlsx, importErrorRows } from '../../common/excel/import-errors';
import { parseSoftwareSheets, softwareExportColumns } from './software-import';
import { softwareExportShape, type SoftwareKind } from './software-rules';
import { SoftwareService, type SoftwareImportPlan } from './software.service';

/**
 * Nhập Phần mềm từ Excel (UX-E30) — bốn màn (Q-22) dùng chung: file mẫu của màn nào mang đúng
 * sheet + cột của file Xuất màn đó. XEM TRƯỚC rồi mới GHI, bước ghi đối chiếu LẠI từ chính file.
 */
@Injectable()
export class SoftwareImportService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly excelIn: ExcelImportService,
    private readonly excelOut: ExcelExportService,
    private readonly software: SoftwareService,
  ) {}

  /** File mẫu của một màn = mọi hồ sơ của các loại đó, đúng sheet + cột của file Xuất. */
  async template(kinds: SoftwareKind[] | undefined): Promise<{ buffer: Buffer; fileName: string }> {
    const shape = softwareExportShape(kinds);
    const rows = await this.software.listAll({ kinds });
    const buffer = await this.excelOut.build({ sheetName: shape.sheetName, columns: softwareExportColumns(shape), rows });
    return { buffer, fileName: `mau-${shape.fileName}` };
  }

  async preview(buffer: Buffer): Promise<SoftwareImportPlan> {
    const parsed = parseSoftwareSheets(await this.excelIn.read(buffer));
    if (parsed === null) {
      throw new BadRequestException({
        code: 'SOFTWARE_FILE_UNRECOGNIZED',
        message:
          'File không có sheet nào tên "Phần mềm", "Tên miền & SSL", "Hợp đồng bảo trì" hay "Dịch vụ có hạn khác". Hãy bấm "Tải file mẫu" và điền vào đó.',
      });
    }
    return this.software.planImport(parsed);
  }

  async errorsFile(buffer: Buffer): Promise<Buffer> {
    const plan = await this.preview(buffer);
    return buildImportErrorsXlsx(this.excelOut, importErrorRows(plan.rows));
  }

  async commit(actor: string, buffer: Buffer): Promise<{ plan: SoftwareImportPlan; created: number; updated: number }> {
    const plan = await this.preview(buffer);
    if (plan.summary.error > 0) {
      throw new BadRequestException({
        code: 'SOFTWARE_IMPORT_HAS_ERRORS',
        message: `Còn ${plan.summary.error} dòng lỗi — sửa trong file rồi tải lên lại. Chưa ghi gì cả.`,
      });
    }
    const counts = await this.db.transaction((tx) => this.software.commitImportWithin(tx, actor, plan));
    return { plan, ...counts };
  }
}
