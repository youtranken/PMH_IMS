import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DB, type Database } from '../../database/database.module';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { ExcelImportService } from '../../common/excel/excel-import.service';
import { buildImportErrorsXlsx, importErrorRows } from '../../common/excel/import-errors';
import { parseServiceAccountSheet, SERVICE_ACCOUNT_SHEET, serviceAccountExportColumns } from './service-account-import';
import { ServiceAccountService, type ServiceAccountImportPlan } from './service-account.service';

/**
 * Nhập tài khoản dịch vụ từ Excel (UX-E30) — cùng khuôn với nhập thiết bị: XEM TRƯỚC rồi mới GHI,
 * và bước ghi đối chiếu LẠI từ chính file gửi lên lần hai (không cất plan ở server), nên "cái được
 * duyệt" và "cái được ghi" luôn là một.
 */
@Injectable()
export class ServiceAccountImportService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly excelIn: ExcelImportService,
    private readonly excelOut: ExcelExportService,
    private readonly accounts: ServiceAccountService,
  ) {}

  /** File mẫu = mọi tài khoản đang có, đúng bộ cột của file Xuất — sửa rồi nhập lại. */
  async template(): Promise<Buffer> {
    return this.excelOut.build({
      sheetName: SERVICE_ACCOUNT_SHEET,
      columns: serviceAccountExportColumns(),
      rows: await this.accounts.listAll({}),
    });
  }

  async preview(buffer: Buffer): Promise<ServiceAccountImportPlan> {
    const parsed = parseServiceAccountSheet(await this.excelIn.read(buffer));
    if (parsed === null) {
      throw new BadRequestException({
        code: 'SERVICE_ACCOUNT_FILE_UNRECOGNIZED',
        message: `File không có sheet nào tên "${SERVICE_ACCOUNT_SHEET}". Hãy bấm "Tải file mẫu" và điền vào đó.`,
      });
    }
    return this.accounts.planImport(parsed);
  }

  /** File "dòng lỗi" của lượt đối chiếu — không ghi gì. */
  async errorsFile(buffer: Buffer): Promise<Buffer> {
    const plan = await this.preview(buffer);
    return buildImportErrorsXlsx(
      this.excelOut,
      importErrorRows(plan.rows.map((row) => ({ ...row, sheet: SERVICE_ACCOUNT_SHEET }))),
    );
  }

  async commit(actor: string, buffer: Buffer): Promise<{ plan: ServiceAccountImportPlan; created: number; updated: number }> {
    const plan = await this.preview(buffer);
    if (plan.summary.error > 0) {
      throw new BadRequestException({
        code: 'SERVICE_ACCOUNT_IMPORT_HAS_ERRORS',
        message: `Còn ${plan.summary.error} dòng lỗi — sửa trong file rồi tải lên lại. Chưa ghi gì cả.`,
      });
    }
    const counts = await this.db.transaction((tx) => this.accounts.commitImportWithin(tx, actor, plan));
    return { plan, ...counts };
  }
}
