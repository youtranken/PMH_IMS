import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { pgErrorCode, PG_UNIQUE_VIOLATION } from '../../common/sql';
import { DevicesApiService } from '../devices/devices.api';
import { licenseAssignmentTable } from './software.schema';
import { SoftwareService } from './software.service';
import { supportsSeats } from './software-rules';

export interface AssignmentRow {
  id: string;
  softwareId: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  assignedBy: string;
  assignedAt: Date;
  releasedBy: string | null;
  releasedAt: Date | null;
  overSeatReason: string | null;
  note: string | null;
}

/** Kết quả gán: có thể kèm cảnh báo vượt seat mà vẫn ghi (AC 3.2). */
export interface AssignResult {
  assignment: AssignmentRow;
  warnings: string[];
}

/**
 * Gán license vào thiết bị (story 3.2, FR-011).
 *
 * Thuộc module `software` vì bảng nói về license. Thông tin thiết bị lấy qua
 * `DevicesApiService` — KHÔNG join sang bảng `device` (AD-2).
 */
@Injectable()
export class LicenseAssignmentService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly software: SoftwareService,
    private readonly devices: DevicesApiService,
  ) {}

  /** Số seat đang dùng của nhiều license một lượt — màn danh sách gọi, không N+1. */
  async usageFor(softwareIds: string[]): Promise<Map<string, number>> {
    if (softwareIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        softwareId: licenseAssignmentTable.softwareId,
        used: count(),
      })
      .from(licenseAssignmentTable)
      .where(
        and(
          inArray(licenseAssignmentTable.softwareId, softwareIds),
          isNull(licenseAssignmentTable.releasedAt),
        ),
      )
      .groupBy(licenseAssignmentTable.softwareId);
    return new Map(rows.map((row) => [row.softwareId, Number(row.used)]));
  }

  /**
   * Danh sách máy đang dùng key. `includeReleased` mở cả những dòng đã gỡ — "key này từng
   * nhập máy nào" là câu hỏi kiểm toán, không được mất.
   */
  async listFor(softwareId: string, includeReleased = false): Promise<AssignmentRow[]> {
    const rows = await this.db
      .select()
      .from(licenseAssignmentTable)
      .where(
        includeReleased
          ? eq(licenseAssignmentTable.softwareId, softwareId)
          : and(
              eq(licenseAssignmentTable.softwareId, softwareId),
              isNull(licenseAssignmentTable.releasedAt),
            ),
      )
      .orderBy(desc(licenseAssignmentTable.assignedAt));
    return this.decorate(rows);
  }

  /** License đang nằm ở một thiết bị — panel trên trang thiết bị (story 3.2 + khu mở rộng 2.5). */
  async listForDevice(deviceId: string): Promise<AssignmentRow[]> {
    const rows = await this.db
      .select()
      .from(licenseAssignmentTable)
      .where(
        and(
          eq(licenseAssignmentTable.deviceId, deviceId),
          isNull(licenseAssignmentTable.releasedAt),
        ),
      )
      .orderBy(asc(licenseAssignmentTable.assignedAt));
    return this.decorate(rows);
  }

  async assign(
    actor: string,
    softwareId: string,
    input: { deviceId: string; note?: string | null; overSeatReason?: string | null },
  ): Promise<AssignResult> {
    const software = await this.software.findOne(softwareId);
    if (!supportsSeats(software.kind)) {
      throw new BadRequestException({
        code: 'NOT_A_LICENSE',
        message: 'Chỉ hồ sơ loại License mới gán được vào máy.',
      });
    }
    if (!(await this.devices.exists(input.deviceId))) {
      throw new BadRequestException({
        code: 'DEVICE_NOT_FOUND',
        message: 'Thiết bị được chọn không tồn tại.',
      });
    }

    const used = (await this.usageFor([softwareId])).get(softwareId) ?? 0;
    const warnings: string[] = [];
    if (software.seatTotal !== null && used >= software.seatTotal) {
      // AC 3.2: cho ghi đè nhưng PHẢI có lý do — vượt seat là chuyện pháp lý với nhà cung
      // cấp, không thể để lặng lẽ.
      if (!input.overSeatReason?.trim()) {
        throw new BadRequestException({
          code: 'SEAT_LIMIT_REACHED',
          message: `License này đã dùng hết ${software.seatTotal} seat. Vẫn gán được nhưng phải ghi lý do.`,
        });
      }
      warnings.push(
        `Đang vượt seat: ${used + 1}/${software.seatTotal}. Lý do đã được ghi vào lịch sử.`,
      );
    }

    const id = await this.db.transaction(async (tx) => {
      let inserted;
      try {
        inserted = await tx
          .insert(licenseAssignmentTable)
          .values({
            softwareId,
            deviceId: input.deviceId,
            assignedBy: actor,
            note: input.note?.trim() || null,
            overSeatReason: input.overSeatReason?.trim() || null,
          })
          .returning();
      } catch (error) {
        if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
          throw new ConflictException({
            code: 'ALREADY_ASSIGNED',
            message: 'License này đã được gán vào đúng máy đó rồi.',
          });
        }
        throw error;
      }
      await this.software.recordWithin(tx, actor, softwareId, 'license-assigned', {
        deviceId: { before: null, after: input.deviceId },
        ...(input.overSeatReason
          ? { overSeatReason: { before: null, after: input.overSeatReason.trim() } }
          : {}),
      });
      return inserted[0].id;
    });

    const rows = await this.db
      .select()
      .from(licenseAssignmentTable)
      .where(eq(licenseAssignmentTable.id, id));
    return { assignment: (await this.decorate(rows))[0], warnings };
  }

  /** Gỡ gán = đánh dấu released, KHÔNG xóa dòng (AC 3.2). */
  async release(actor: string, softwareId: string, assignmentId: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(licenseAssignmentTable)
      .where(
        and(
          eq(licenseAssignmentTable.id, assignmentId),
          eq(licenseAssignmentTable.softwareId, softwareId),
          isNull(licenseAssignmentTable.releasedAt),
        ),
      );
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'ASSIGNMENT_NOT_FOUND',
        message: 'Không tìm thấy bản ghi gán còn hiệu lực này.',
      });
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(licenseAssignmentTable)
        .set({ releasedAt: new Date(), releasedBy: actor })
        .where(eq(licenseAssignmentTable.id, assignmentId));
      await this.software.recordWithin(tx, actor, softwareId, 'license-released', {
        deviceId: { before: rows[0].deviceId, after: null },
      });
    });
  }

  /** Gắn mã + tên thiết bị (một lượt hỏi devices.api, không N+1). */
  private async decorate(
    rows: (typeof licenseAssignmentTable.$inferSelect)[],
  ): Promise<AssignmentRow[]> {
    const out: AssignmentRow[] = [];
    for (const row of rows) {
      let deviceCode = '(thiết bị không còn)';
      let deviceName = '';
      try {
        const device = await this.devices.getById(row.deviceId);
        deviceCode = device.code;
        deviceName = device.name;
      } catch {
        // Thiết bị bị khóa/thanh lý vẫn đọc được; chỉ khi dữ liệu hỏng mới rơi vào đây.
        // Không được để một bản ghi lạ làm sập cả bảng gán.
      }
      out.push({
        id: row.id,
        softwareId: row.softwareId,
        deviceId: row.deviceId,
        deviceCode,
        deviceName,
        assignedBy: row.assignedBy,
        assignedAt: row.assignedAt,
        releasedBy: row.releasedBy,
        releasedAt: row.releasedAt,
        overSeatReason: row.overSeatReason,
        note: row.note,
      });
    }
    return out;
  }
}

