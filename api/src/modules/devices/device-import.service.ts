import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { ExcelImportService } from '../../common/excel/excel-import.service';
import { normalizeKey } from '../../common/import-plan';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CatalogApiService } from '../catalog/catalog.api';
import {
  planDeviceImport,
  type DeviceImportContext,
  type DeviceImportPlan,
} from './device-import';
import { deviceExportSheets, deviceTemplateSheets } from './device-template';
import { deviceTable } from './devices.schema';
import { DevicesService } from './devices.service';
import type { DeviceFilter } from './devices.types';

export interface DeviceImportResult {
  plan: DeviceImportPlan;
  created: number;
  updated: number;
}

/**
 * Import / export thiết bị (story 2.6).
 *
 * Cùng khuôn với import danh mục: XEM TRƯỚC rồi mới GHI, và bước ghi TÍNH LẠI plan từ
 * chính file gửi lên lần hai — không cất plan ở server nên "cái được duyệt" và "cái được
 * ghi" luôn là một.
 */
@Injectable()
export class DeviceImportService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly excelIn: ExcelImportService,
    private readonly excelOut: ExcelExportService,
    private readonly devices: DevicesService,
    private readonly catalog: CatalogApiService,
    private readonly audit: AuditWriterService,
  ) {}

  /** File mẫu = thiết bị đang có (nếu kho rỗng thì 2 dòng ví dụ) + sheet Hướng dẫn. */
  async buildTemplate(): Promise<Buffer> {
    const devices = await this.devices.listAll({});
    return this.excelOut.buildWorkbook(deviceTemplateSheets(devices));
  }

  /** FR-028: xuất đúng những gì đang lọc trên màn hình, không phải cả kho. */
  async buildExport(filter: DeviceFilter): Promise<Buffer> {
    const devices = await this.devices.listAll(filter);
    return this.excelOut.buildWorkbook(deviceExportSheets(devices));
  }

  async preview(buffer: Buffer): Promise<DeviceImportPlan> {
    const sheets = await this.excelIn.read(buffer);
    const plan = planDeviceImport(sheets, await this.context());
    if (!plan.hasRecognizedSheet) {
      throw new BadRequestException({
        code: 'DEVICE_FILE_UNRECOGNIZED',
        message:
          'File không có sheet nào tên "Thiết bị". Hãy bấm "Tải file mẫu" và điền vào đó.',
      });
    }
    return plan;
  }

  /**
   * Ghi thật. AC 2.6: MỘT transaction cho cả file — lỗi ở dòng 200 thì 199 dòng trước cũng
   * không được ở lại. Nhập 300 thiết bị mà thành công một nửa thì không ai biết phải làm gì tiếp.
   */
  async commit(actor: string, buffer: Buffer): Promise<DeviceImportResult> {
    const plan = await this.preview(buffer);
    if (plan.summary.error > 0) {
      throw new BadRequestException({
        code: 'DEVICE_IMPORT_HAS_ERRORS',
        message: `Còn ${plan.summary.error} dòng lỗi — sửa trong file rồi tải lên lại. Chưa ghi gì cả.`,
      });
    }

    const writable = plan.rows.filter(
      (row) => row.action === 'create' || row.action === 'update',
    );

    const counts = await this.db.transaction(async (tx) => {
      let created = 0;
      let updated = 0;
      for (const row of writable) {
        const values = row.values ?? {};
        if (row.action === 'create') {
          const device = await this.devices.insertWithin(tx, values);
          created += 1;
          await this.devices.recordWithin(tx, actor, device.id, 'imported', {
            code: { before: null, after: device.code },
          });
        } else {
          await this.devices.updateWithin(tx, row.existingId!, values);
          updated += 1;
          await this.devices.recordWithin(tx, actor, row.existingId!, 'imported-update', {
            code: { before: row.label, after: row.label },
          });
        }
      }
      // AC 2.6: kết quả import ghi audit KÈM SỐ DÒNG — sau này còn đối chiếu được
      // "hôm đó ai nhập bao nhiêu dòng".
      await this.audit.appendWithin(tx, {
        actor,
        action: 'device.imported',
        objectType: 'device',
        detail: {
          created,
          updated,
          unchanged: plan.summary.unchanged,
          skipped: plan.summary.skip,
          totalRows: plan.rows.length,
        },
      });
      return { created, updated };
    });

    return { plan, ...counts };
  }

  /** Ảnh chụp danh mục + kho thiết bị để đối chiếu file. */
  private async context(): Promise<DeviceImportContext> {
    const [lists, rows] = await Promise.all([
      this.catalog.lists({ includeInactive: true }),
      // Cả kho, kể cả thiết bị đã thanh lý: import trùng mã phải nhận ra là CẬP NHẬT,
      // không được tạo bản ghi thứ hai cùng mã (unique constraint sẽ chặn, nhưng người
      // dùng đáng được thấy "cập nhật" ở bảng đối chiếu thay vì một lỗi khó hiểu).
      this.db.select().from(deviceTable).orderBy(asc(deviceTable.code)),
    ]);

    return {
      catalog: {
        sites: new Map(lists.sites.map((site) => [normalizeKey(site.code), site])),
        cabinets: new Map(
          lists.cabinets.map((cabinet) => [
            `${normalizeKey(cabinet.siteCode)} ${normalizeKey(cabinet.code)}`,
            cabinet,
          ]),
        ),
        deviceTypes: new Map(lists.deviceTypes.map((type) => [normalizeKey(type.name), type])),
        vendors: new Map(lists.vendors.map((vendor) => [normalizeKey(vendor.name), vendor])),
      },
      devices: new Map(rows.map((row) => [normalizeKey(row.code), row])),
    };
  }
}
