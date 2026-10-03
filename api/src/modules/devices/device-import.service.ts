import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { ExcelImportService } from '../../common/excel/excel-import.service';
import { buildImportErrorsXlsx, importErrorRows } from '../../common/excel/import-errors';
import { normalizeKey, summarize } from '../../common/import-plan';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CatalogApiService } from '../catalog/catalog.api';
import {
  planDeviceImport,
  type DeviceImportContext,
  type DeviceImportPlan,
  type DeviceImportRow,
} from './device-import';
import { diffDevice } from './device-changes';
import { deviceExportSheets, deviceTemplateSheets } from './device-template';
import { deviceTable } from './devices.schema';
import {
  DEVICE_SORT_DEFAULT,
  DevicesService,
  rackClaimOf,
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
 * Import / export thiết bị (FR-001 + FR-028).
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

  /** File "dòng lỗi" của lượt đối chiếu (ADM-005) — sheet "Thiết bị" như file mẫu. Không ghi gì. */
  async errorsFile(buffer: Buffer): Promise<Buffer> {
    const plan = await this.preview(buffer);
    return buildImportErrorsXlsx(
      this.excelOut,
      importErrorRows(plan.rows.map((row) => ({ ...row, sheet: 'Thiết bị' }))),
    );
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
    return this.rejectInactiveRefs(plan, context);
  }

  /**
   * Q-14 ở cửa Excel: dòng tạo/sửa chọn MỚI một mục danh mục đã vô hiệu thành dòng lỗi.
   *
   * Ghi đi qua `insertWithin`/`updateWithin`, không qua `assertRefs` của cửa HTTP, và ảnh chụp
   * đối chiếu gồm cả mục đã vô hiệu — nên không chặn ở đây thì file là cửa sau của luật đó.
   * Chặn ở bước Đối chiếu (cùng hàm cho cả xem trước lẫn ghi) để lỗi hiện theo dòng; `commit`
   * gặp dòng lỗi thì từ chối cả file.
   *
   * `current` là hồ sơ đang có: máy VỐN trỏ vào mục đã vô hiệu nhập lại nguyên cột vẫn qua.
   */
  private async rejectInactiveRefs(
    plan: DeviceImportPlan,
    context: DeviceImportContext,
  ): Promise<DeviceImportPlan> {
    const check = await this.catalog.inactiveRefCheck();
    const byId = new Map([...context.devices.values()].map((device) => [device.id, device]));
    const rows = plan.rows.map((row): DeviceImportRow => {
      if (row.action !== 'create' && row.action !== 'update') return row;
      const current = row.existingId ? (byId.get(row.existingId) ?? null) : null;
      const errors = check(row.values ?? {}, current);
      if (errors.length === 0) return row;
      return { rowNumber: row.rowNumber, label: row.label, action: 'error', message: errors.join(' ') };
    });
    return { ...plan, rows, summary: summarize(rows) };
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
      /*
       * "Trước khi sửa" của mọi dòng sửa đọc TRONG transaction, khoá FOR UPDATE, rồi hỏi lại "đã
       * thanh lý chưa": plan chặn máy đã thanh lý theo ảnh chụp lúc đối chiếu, nên một lượt thanh
       * lý commit sau đó vẫn bị file ghi đè. Đừng lấy từ `context.devices` — tra trượt rơi về
       * object rỗng và `device_history` (chỉ-thêm, FR-007) ghi "mọi trường đổi từ trống".
       */
      const befores = new Map<string, Awaited<ReturnType<DevicesService['requireRowWithin']>>>();
      for (const row of writable) {
        if (row.action !== 'update') continue;
        const before = await this.devices.requireRowWithin(tx, row.existingId!, 'update');
        this.devices.assertNotRetired(before);
        befores.set(row.existingId!, before);
      }
      /*
       * Dời chỗ U hai pha: đối chiếu xét vị trí CUỐI của cả file (hoán đổi hai máy là hợp lệ),
       * nên gỡ U mọi máy đổi chỗ trước rồi mới đặt — ghi lần lượt thì dòng đầu va vào máy chưa
       * kịp dời và cả file bị huỷ dù bảng đối chiếu báo xanh. Máy bị gỡ được ghi lại U cuối
       * TƯỜNG MINH ở pha hai (kể cả khi file không có cột U).
       */
      const vacated = new Set<string>();
      for (const row of writable) {
        const before = row.existingId ? befores.get(row.existingId) : undefined;
        if (!before || before.rackUStart === null) continue;
        const next = rackClaimOf(row.values ?? {}, before);
        const current = rackClaimOf({}, before);
        if (!next || !current || next.cabinetId !== current.cabinetId || next.start !== current.start || next.size !== current.size) {
          vacated.add(before.id);
        }
      }
      await this.devices.vacateRackWithin(tx, [...vacated]);

      for (const row of writable) {
        const values = row.values ?? {};
        if (row.action === 'create') {
          // Đối chiếu đã xét chồng U trên ảnh chụp; kiểm lại trong tx vì kho có thể đổi từ lúc đó.
          await this.devices.assertRackFreeWithin(tx, null, rackClaimOf(values, null));
          const device = await this.devices.insertWithin(tx, values);
          created += 1;
          await this.devices.recordWithin(tx, actor, device.id, 'imported', {
            code: { before: null, after: device.code },
          });
        } else {
          const before = befores.get(row.existingId!)!;
          const written = vacated.has(before.id)
            ? {
                ...values,
                rackUStart: values.rackUStart === undefined ? before.rackUStart : values.rackUStart,
                rackUSize: values.rackUSize === undefined ? before.rackUSize : values.rackUSize,
              }
            : values;
          await this.devices.assertRackFreeWithin(tx, row.existingId!, rackClaimOf(written, before));
          await this.devices.updateWithin(tx, row.existingId!, written);
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
