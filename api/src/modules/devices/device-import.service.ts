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
import { diffDevice } from './device-changes';
import { deviceExportSheets, deviceTemplateSheets } from './device-template';
import { deviceTable } from './devices.schema';
import {
  DEVICE_SORT_DEFAULT,
  DevicesService,
  type DeviceSortKey,
} from './devices.service';
import type { SortQuery } from '../../common/sorting';
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
  async buildExport(
    filter: DeviceFilter,
    sort: SortQuery<DeviceSortKey> = DEVICE_SORT_DEFAULT,
  ): Promise<Buffer> {
    const devices = await this.devices.listAll(filter, sort);
    return this.excelOut.buildWorkbook(deviceExportSheets(devices));
  }

  async preview(buffer: Buffer): Promise<DeviceImportPlan> {
    return this.planFrom(buffer, await this.context());
  }

  private async planFrom(
    buffer: Buffer,
    context: DeviceImportContext,
  ): Promise<DeviceImportPlan> {
    const sheets = await this.excelIn.read(buffer);
    const plan = planDeviceImport(sheets, context);
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
    // Dựng context MỘT LẦN rồi dùng cho cả đối chiếu lẫn việc ghi lịch sử: hồ sơ "trước khi
    // sửa" đã nằm sẵn trong đó, không phải đọc lại DB.
    const context = await this.context();
    const plan = await this.planFrom(buffer, context);
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
          /*
           * "Trước khi sửa" đọc TRONG transaction, không lấy từ ảnh chụp lúc đối chiếu.
           *
           * Bản trước dùng `context.devices.get(...)` — ảnh chụp dựng ở đầu `commit()` — và
           * khi tra trượt thì rơi về `before ?? {}`. `{...undefined}` không ném, nên
           * `diffDevice` lặng lẽ so hồ sơ mới với một object RỖNG và `device_history` ghi
           * "mọi trường đổi từ trống": một dòng lịch sử BỊA, trong bảng chỉ-thêm mà FR-007
           * dựng ra để trả lời "ai đổi gì" (rà soát 07/09 #10).
           *
           * Đọc lại trong tx sửa cả hai vế: nội dung diff là thật, và hồ sơ đã biến mất thì
           * ném ngay tại đây thay vì `UPDATE` khớp 0 dòng rồi vẫn `updated += 1`.
           */
          const before = await this.devices.requireRowWithin(tx, row.existingId!);
          await this.devices.updateWithin(tx, row.existingId!, values);
          updated += 1;
          // FR-007: tab Lịch sử phải trả lời "ai ĐỔI GÌ". Ghi `mã: SW-01 → SW-01` thì
          // dòng lịch sử tồn tại mà vô dụng — dùng đúng bộ so của luồng sửa tay.
          await this.devices.recordWithin(
            tx,
            actor,
            row.existingId!,
            'imported-update',
            diffDevice(before, values),
          );
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

  /**
   * Ảnh chụp danh mục + kho thiết bị để đối chiếu file.
   *
   * Danh mục lấy nguyên `CatalogApiService.snapshot()` — KHÔNG tự dựng lại map ở đây.
   * Luật đặt khóa (nhất là khóa ghép `site + tủ`) phải chỉ có MỘT bản: hai bản thì sửa
   * một chỗ là import danh mục đúng còn import thiết bị lệch (AD-15).
   */
  private async context(): Promise<DeviceImportContext> {
    const [catalog, rows] = await Promise.all([
      this.catalog.snapshot(),
      // Cả kho, kể cả thiết bị đã thanh lý: import trùng mã phải nhận ra là CẬP NHẬT,
      // không được tạo bản ghi thứ hai cùng mã (unique constraint sẽ chặn, nhưng người
      // dùng đáng được thấy "cập nhật" ở bảng đối chiếu thay vì một lỗi khó hiểu).
      this.db.select().from(deviceTable).orderBy(asc(deviceTable.code)),
    ]);

    return {
      catalog,
      devices: new Map(rows.map((row) => [normalizeKey(row.code), row])),
    };
  }
}
