import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { ExcelImportService } from '../../common/excel/excel-import.service';
import { buildImportErrorsXlsx, importErrorRows } from '../../common/excel/import-errors';
import { AuditWriterService } from '../audit/audit-writer.service';
import { IMPORT_SHEET_NAME, planCatalogImport, type ImportPlan } from './catalog-import';
import { catalogTemplateSheets } from './catalog-template';
import { CatalogService } from './catalog.service';

export interface ImportResult {
  plan: ImportPlan;
  created: number;
  updated: number;
}

/**
 * Ghép file Excel với lõi đối chiếu thuần (`planCatalogImport`).
 *
 * XEM TRƯỚC và GHI dùng chung một hàm dựng plan, và bước ghi TÍNH LẠI plan từ chính file
 * được gửi lên lần hai — không cất plan ở server giữa hai bước. Cất lại thì phải nghĩ tới
 * hết hạn, dọn rác, và ai được xác nhận plan của ai; tính lại thì "cái được duyệt" và
 * "cái được ghi" luôn là một, đổi file giữa chừng cũng lộ ra ở bảng đối chiếu trả về.
 */
@Injectable()
export class CatalogImportService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly excelIn: ExcelImportService,
    private readonly excelOut: ExcelExportService,
    private readonly catalog: CatalogService,
    private readonly audit: AuditWriterService,
  ) {}

  /** File mẫu = danh mục đang có + dòng ví dụ cho phần còn trống (AC 2.1). */
  async buildTemplate(): Promise<Buffer> {
    const lists = await this.catalog.lists({ includeInactive: true });
    return this.excelOut.buildWorkbook(catalogTemplateSheets(lists));
  }

  async preview(buffer: Buffer): Promise<ImportPlan> {
    const sheets = await this.excelIn.read(buffer);
    const plan = planCatalogImport(sheets, await this.catalog.snapshot());
    if (!plan.hasRecognizedSheet) {
      throw new BadRequestException({
        code: 'CATALOG_FILE_UNRECOGNIZED',
        message:
          'File không có sheet nào tên Site / Tủ mạng / Loại thiết bị / Nhà cung cấp. Hãy bấm "Tải file mẫu" và điền vào đó.',
      });
    }
    return plan;
  }

  /** File "dòng lỗi" của lượt đối chiếu — Sheet · Dòng · Mục · Lý do (ADM-005). Không ghi gì. */
  async errorsFile(buffer: Buffer): Promise<Buffer> {
    const plan = await this.preview(buffer);
    return buildImportErrorsXlsx(
      this.excelOut,
      importErrorRows(plan.rows.map((row) => ({ ...row, sheet: IMPORT_SHEET_NAME[row.sheet] }))),
    );
  }

  /**
   * Ghi thật. AC 2.1: một transaction cho cả file — lỗi ở dòng 200 thì 199 dòng trước
   * cũng không được ở lại, tránh cảnh "import một nửa" không ai biết dừng ở đâu.
   */
  async commit(actor: string, buffer: Buffer): Promise<ImportResult> {
    const plan = await this.preview(buffer);
    if (plan.summary.error > 0) {
      throw new BadRequestException({
        code: 'CATALOG_IMPORT_HAS_ERRORS',
        message: `Còn ${plan.summary.error} dòng lỗi — sửa trong file rồi tải lên lại. Chưa ghi gì cả.`,
      });
    }
    const writable = plan.rows
      .filter((row) => row.action === 'create' || row.action === 'update')
      .map((row) => ({
        sheet: row.sheet,
        action: row.action as 'create' | 'update',
        values: { ...row.values },
        existingId: row.existingId,
      }));

    const result = await this.db.transaction(async (tx) => {
      const counts = await this.catalog.applyImportWithin(tx, actor, writable);
      await this.audit.appendWithin(tx, {
        actor,
        action: 'catalog.imported',
        objectType: 'catalog',
        detail: { ...counts, skipped: plan.summary.skip, unchanged: plan.summary.unchanged },
      });
      return counts;
    });

    return { plan, ...result };
  }
}
