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
import { licenseAssignmentTable, softwareTable } from './software.schema';
import { SoftwareService } from './software.service';
import {
  supportsSeats,
  validateAssignmentTerms,
  type AssignmentTerms,
  type LicenseModel,
} from './software-rules';

export interface AssignmentRow extends AssignmentTerms {
  id: string;
  softwareId: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  /** Ai đang giữ máy — "ghế này ai ngồi" là câu hỏi đầu tiên khi rà license. */
  deviceAssignedTo: string | null;
  assignedBy: string;
  assignedAt: Date;
  releasedBy: string | null;
  releasedAt: Date | null;
  overSeatReason: string | null;
  note: string | null;
}

/** Một license đang cài trên MỘT máy — dùng cho khu bung dòng của danh sách thiết bị. */
export interface InstalledLicenseRow extends AssignmentTerms {
  id: string;
  softwareId: string;
  softwareCode: string;
  softwareName: string;
  licenseModel: LicenseModel;
  /** Hạn của HỒ SƠ — hiện khi ghế không khai kỳ hạn riêng. */
  softwareEndDate: string | null;
  assignedAt: Date;
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

  /**
   * Máy này đang cài license nào — kèm kỳ hạn/chi phí riêng của từng ghế.
   *
   * Join thẳng sang `software` là HỢP LỆ: cả hai bảng cùng một chủ (module `software`,
   * AD-3). Thứ AD-2 cấm là join sang bảng của module KHÁC — nên mã/tên máy vẫn phải hỏi
   * qua `devices.api`, và ở đây thì không cần hỏi vì máy đã biết trước.
   */
  async installedForDevice(deviceId: string): Promise<InstalledLicenseRow[]> {
    const rows = await this.db
      .select({
        id: licenseAssignmentTable.id,
        softwareId: softwareTable.id,
        softwareCode: softwareTable.code,
        softwareName: softwareTable.name,
        licenseModel: softwareTable.licenseModel,
        softwareEndDate: softwareTable.endDate,
        assignedAt: licenseAssignmentTable.assignedAt,
        note: licenseAssignmentTable.note,
        cost: licenseAssignmentTable.cost,
        contract: licenseAssignmentTable.contract,
        startDate: licenseAssignmentTable.startDate,
        endDate: licenseAssignmentTable.endDate,
      })
      .from(licenseAssignmentTable)
      .innerJoin(softwareTable, eq(softwareTable.id, licenseAssignmentTable.softwareId))
      .where(
        and(
          eq(licenseAssignmentTable.deviceId, deviceId),
          isNull(licenseAssignmentTable.releasedAt),
        ),
      )
      .orderBy(asc(softwareTable.code));
    return rows.map((row) => ({
      ...row,
      licenseModel: row.licenseModel as LicenseModel,
    }));
  }

  /**
   * Đếm license đang cài của NHIỀU máy một lượt — danh sách thiết bị gọi để biết dòng nào
   * đáng mọc mũi tên bung. Một lượt hỏi cho cả trang, không N+1.
   *
   * Không có con số này thì mũi tên phải hiện ở mọi dòng, và bấm vào phần lớn sẽ ra rỗng —
   * đúng kiểu hứa hão mà bảng đã tránh ở màn phần mềm.
   */
  async installedCountsFor(deviceIds: string[]): Promise<Map<string, number>> {
    if (deviceIds.length === 0) return new Map();
    const rows = await this.db
      .select({ deviceId: licenseAssignmentTable.deviceId, used: count() })
      .from(licenseAssignmentTable)
      .where(
        and(
          inArray(licenseAssignmentTable.deviceId, deviceIds),
          isNull(licenseAssignmentTable.releasedAt),
        ),
      )
      .groupBy(licenseAssignmentTable.deviceId);
    return new Map(rows.map((row) => [row.deviceId, Number(row.used)]));
  }

  async assign(
    actor: string,
    softwareId: string,
    input: {
      deviceId: string;
      note?: string | null;
      overSeatReason?: string | null;
    } & Partial<AssignmentTerms>,
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

    const terms = normalizeTerms(input);
    assertTerms(terms, software.licenseModel);

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
            ...terms,
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

  /**
   * Sửa kỳ hạn / chi phí / hợp đồng / ghi chú của MỘT ghế đang dùng.
   *
   * Chỉ sửa được ghế còn hiệu lực: bản ghi đã gỡ là dấu vết lịch sử ("key này từng nhập máy
   * nào"), sửa lại thì lịch sử không còn là lịch sử nữa.
   *
   * Ghi vào `software_history` chứ không lặng lẽ đổi: chi phí và số hợp đồng là thứ đem đi
   * đối chiếu quyết toán, phải biết ai đổi lúc nào.
   */
  async updateTerms(
    actor: string,
    softwareId: string,
    assignmentId: string,
    input: Partial<AssignmentTerms> & { note?: string | null },
  ): Promise<AssignmentRow> {
    const existing = await this.db
      .select()
      .from(licenseAssignmentTable)
      .where(
        and(
          eq(licenseAssignmentTable.id, assignmentId),
          eq(licenseAssignmentTable.softwareId, softwareId),
          isNull(licenseAssignmentTable.releasedAt),
        ),
      );
    if (existing.length === 0) {
      throw new NotFoundException({
        code: 'ASSIGNMENT_NOT_FOUND',
        message: 'Không tìm thấy bản ghi gán còn hiệu lực này.',
      });
    }
    const before = existing[0];
    const software = await this.software.findOne(softwareId);

    // Ghép bản sửa lên giá trị đang có RỒI mới soi luật: sửa mỗi ngày kết thúc vẫn phải
    // kiểm với ngày bắt đầu cũ, nếu không thì lách được bằng cách sửa từng ô một.
    const terms = normalizeTerms({
      cost: input.cost === undefined ? before.cost : input.cost,
      contract: input.contract === undefined ? before.contract : input.contract,
      startDate: input.startDate === undefined ? before.startDate : input.startDate,
      endDate: input.endDate === undefined ? before.endDate : input.endDate,
    });
    assertTerms(terms, software.licenseModel);
    const note = input.note === undefined ? before.note : input.note?.trim() || null;

    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const [key, after] of Object.entries({ ...terms, note })) {
      const prev = (before as Record<string, unknown>)[key] ?? null;
      if (prev !== after) changes[key] = { before: prev, after };
    }
    // Không có gì đổi thì không ghi một dòng lịch sử rỗng — nhật ký loãng là nhật ký không ai đọc.
    if (Object.keys(changes).length === 0) {
      return (await this.decorate(existing))[0];
    }

    // Mã máy đi kèm làm BỐI CẢNH (before === after): một license 10 ghế thì dòng lịch sử
    // "đổi chi phí" không nói được gì nếu thiếu chỗ ngồi nào vừa đổi.
    const deviceCode = await this.deviceCodeOf(before.deviceId);

    await this.db.transaction(async (tx) => {
      await tx
        .update(licenseAssignmentTable)
        .set({ ...terms, note })
        .where(eq(licenseAssignmentTable.id, assignmentId));
      await this.software.recordWithin(tx, actor, softwareId, 'license-terms-updated', {
        device: { before: deviceCode, after: deviceCode },
        ...changes,
      });
    });

    const rows = await this.db
      .select()
      .from(licenseAssignmentTable)
      .where(eq(licenseAssignmentTable.id, assignmentId));
    return (await this.decorate(rows))[0];
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

  /** Mã máy để đọc, hoặc chính uuid nếu máy đã biến mất — không được để sập cả lời gọi. */
  private async deviceCodeOf(deviceId: string): Promise<string> {
    try {
      return (await this.devices.getById(deviceId)).code;
    } catch {
      return deviceId;
    }
  }

  /** Gắn mã + tên thiết bị (một lượt hỏi devices.api, không N+1). */
  private async decorate(
    rows: (typeof licenseAssignmentTable.$inferSelect)[],
  ): Promise<AssignmentRow[]> {
    const out: AssignmentRow[] = [];
    for (const row of rows) {
      let deviceCode = '(thiết bị không còn)';
      let deviceName = '';
      let deviceAssignedTo: string | null = null;
      try {
        const device = await this.devices.getById(row.deviceId);
        deviceCode = device.code;
        deviceName = device.name;
        deviceAssignedTo = device.assignedTo;
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
        deviceAssignedTo,
        assignedBy: row.assignedBy,
        assignedAt: row.assignedAt,
        releasedBy: row.releasedBy,
        releasedAt: row.releasedAt,
        overSeatReason: row.overSeatReason,
        note: row.note,
        cost: row.cost,
        contract: row.contract,
        startDate: row.startDate,
        endDate: row.endDate,
      });
    }
    return out;
  }
}

/**
 * Đưa bản khai của người dùng về đúng hình dạng lưu trong DB.
 *
 * Chuỗi rỗng nghĩa là XÓA giá trị đang có, không phải lưu một chuỗi rỗng: form luôn hiện đủ
 * ô, nên "để trống" là một ý định rõ ràng.
 */
function normalizeTerms(input: Partial<AssignmentTerms>): AssignmentTerms {
  return {
    cost: input.cost ?? null,
    contract: input.contract?.trim() || null,
    startDate: input.startDate || null,
    endDate: input.endDate || null,
  };
}

function assertTerms(terms: AssignmentTerms, licenseModel: LicenseModel): void {
  const errors = validateAssignmentTerms(terms, licenseModel);
  if (errors.length > 0) {
    throw new BadRequestException({
      code: 'INVALID_ASSIGNMENT_TERMS',
      message: errors.join(' '),
      errors,
    });
  }
}

