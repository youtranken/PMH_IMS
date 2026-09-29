import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { requireCas } from '../../common/cas';
import { conflictOnUnique } from '../../common/sql';
import type { Tx } from '../../common/tx';
import { DevicesApiService } from '../devices/devices.api';
import { licenseAssignmentTable, softwareTable } from './software.schema';
import { SoftwareService } from './software.service';
import {
  supportsSeats,
  validateAssignmentTerms,
  type AssignmentTerms,
  type LicenseModel,
  type SoftwareKind,
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
 * Gán license vào thiết bị (FR-011).
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

  /**
   * Hồ sơ đang có ghế (chưa gỡ) trên máy khớp ô tìm — cho ô tìm của danh sách phần mềm.
   *
   * Máy tra qua `DevicesApiService.search` (AD-2) nên khớp đúng luật tìm của màn thiết bị: mã,
   * tên, IP, người dùng. Trần 50 máy: ô tìm là để hỏi "máy này dùng gì", không phải liệt kê
   * cả kho theo một chữ chung chung.
   */
  async softwareIdsOnDevices(term: string): Promise<string[]> {
    return [...(await this.devicesHoldingSeats(term)).keys()];
  }

  /**
   * Như `softwareIdsOnDevices`, kèm MÃ MÁY đang giữ ghế cho từng hồ sơ — danh sách hiện chip
   * "khớp máy X" để người tìm biết vì sao một hồ sơ không có chữ đó trong mã/tên lại hiện ra.
   */
  async devicesHoldingSeats(term: string): Promise<Map<string, string[]>> {
    const text = term.trim();
    if (!text) return new Map();
    const devices = await this.devices.search(text, 50);
    if (devices.length === 0) return new Map();
    const codeOf = new Map(devices.map((device) => [device.id, device.code]));
    const rows = await this.db
      .selectDistinct({
        softwareId: licenseAssignmentTable.softwareId,
        deviceId: licenseAssignmentTable.deviceId,
      })
      .from(licenseAssignmentTable)
      .where(
        and(
          inArray(licenseAssignmentTable.deviceId, [...codeOf.keys()]),
          isNull(licenseAssignmentTable.releasedAt),
        ),
      );
    const out = new Map<string, string[]>();
    for (const row of rows) {
      const list = out.get(row.softwareId) ?? [];
      list.push(codeOf.get(row.deviceId) ?? '');
      out.set(row.softwareId, list);
    }
    for (const list of out.values()) list.sort();
    return out;
  }

  /** Mã máy cho các id — tab Lịch sử đổi `deviceId` thô thành mã (`history-device-codes.ts`). */
  async deviceCodes(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const devices = await this.devices.getByIds(ids);
    return new Map([...devices].map(([id, device]) => [id, device.code]));
  }

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
   * Số ghế đang dùng của MỘT license, đếm bên trong `tx` (AD-5).
   *
   * Tách khỏi `usageFor` vì `usageFor` chạy trên pool — dùng nó để quyết định rồi ghi trong
   * transaction khác là đúng cái khe hở mà `assign` vừa bịt. Hàm này chỉ có nghĩa khi hàng
   * `software` đã được khóa `FOR UPDATE` ngay trước đó.
   */
  private async usedWithin(tx: Tx, softwareId: string): Promise<number> {
    const rows = await tx
      .select({ used: count() })
      .from(licenseAssignmentTable)
      .where(
        and(
          eq(licenseAssignmentTable.softwareId, softwareId),
          isNull(licenseAssignmentTable.releasedAt),
        ),
      );
    return Number(rows[0]?.used ?? 0);
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

  /** License đang nằm ở một thiết bị — panel trên trang thiết bị (khu mở rộng). */
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
  installedForDevice(deviceId: string): Promise<InstalledLicenseRow[]> {
    return this.installedForDeviceWithin(this.db, deviceId);
  }

  /**
   * Bản đọc TRONG transaction — lượt thanh lý phải thấy cả ghế vừa được gán ở một transaction
   * khác vừa commit, chứ không phải ảnh chụp từ một kết nối khác.
   */
  async installedForDeviceWithin(
    tx: Pick<Database, 'select'>,
    deviceId: string,
  ): Promise<InstalledLicenseRow[]> {
    const rows = await tx
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
    const terms = normalizeTerms(input);
    assertTerms(terms, software.licenseModel);

    const { id, warnings } = await this.db.transaction(async (tx) => {
      /*
       * Máy đã thanh lý không được ăn thêm một ghế license nào.
       *
       * KHOÁ THIẾT BỊ TRƯỚC, LICENSE SAU — thứ tự này là bắt buộc và phải giống nhau ở mọi
       * đường ghi, nếu không hai lượt khoá chéo nhau sẽ chết cứng (deadlock). Đường thanh lý
       * (`DevicesService.setStatus` → `releaseForDeviceWithin`) cũng đi đúng chiều này: khoá
       * `device` rồi mới đụng tới `license_assignment`, và không khoá `software` lần nào.
       */
      await this.devices.assertUsableWithin(tx, input.deviceId);
      /*
       * ĐẾM SEAT TRONG TRANSACTION, sau khi đã khóa hàng license.
       *
       * Đừng đếm bằng `this.usageFor([softwareId])` — nó chạy trên pool, NGOÀI transaction
       * bên dưới — rồi chèn vô điều kiện. License 10 ghế đang dùng 9, hai người gán cùng
       * lúc: cả hai đọc `used = 9`, `9 >= 10` là sai nên cả hai qua cửa, cả hai chèn.
       * Thành 11/10 và KHÔNG AI phải khai `overSeatReason` — đúng thứ AC 3.2 dựng ra để
       * chặn, mà vượt seat là chuyện pháp lý với nhà cung cấp chứ không phải cảnh báo cho vui.
       *
       * UNIQUE `(software_id, device_id)` không cứu được: nó canh trùng THIẾT BỊ, không canh
       * SỐ GHẾ. Hai máy khác nhau là hai dòng hợp lệ với nó.
       *
       * `FOR UPDATE` trên hàng `software` là chỗ xếp hàng: hai lượt gán trên cùng một license
       * buộc phải nối đuôi, nên người thứ hai đếm được `used = 10` và bị chặn đúng luật.
       * Khóa trên hàng license (không phải trên các dòng gán) vì dòng gán của người kia CHƯA
       * TỒN TẠI lúc ta đếm — không có gì để mà khóa.
       *
       * ĐỌC LẠI `seat_total` TRONG CHÍNH CÂU KHÓA NÀY, không dùng lại `software.seatTotal`.
       *
       * Chỉ `select({ id })` thì hàng được KHÓA mà không được ĐỌC: phép so bên dưới sẽ lấy
       * con số từ `findOne()` ở đầu hàm — chạy trên pool, trước khi có bất kỳ khóa nào.
       * Giữa hai chỗ đó, một lượt hạ trần (`PATCH /software/:id`, hoặc import sửa hồ sơ) chen
       * vào được: lượt gán đứng chờ khóa, rồi đếm `used` rất đúng và đem so với một cái trần
       * ĐÃ KHÔNG CÒN. Ghế vượt seat lọt vào mà không ai phải khai `overSeatReason` — đúng thứ
       * AC 3.2 dựng ra để chặn (A-05).
       *
       * Khóa đúng chỗ nhưng đọc sai nguồn thì cái khóa chỉ còn là nghi lễ.
       */
      const locked = await tx
        .select({
          seatTotal: softwareTable.seatTotal,
          kind: softwareTable.kind,
          licenseModel: softwareTable.licenseModel,
          status: softwareTable.status,
        })
        .from(softwareTable)
        .where(eq(softwareTable.id, softwareId))
        .for('update');
      /*
       * Hàng biến mất giữa chừng thì DỪNG, đừng suy ra "license không giới hạn ghế".
       *
       * `findOne()` ở đầu hàm đã khẳng định nó tồn tại; nếu tới đây không còn thì ai đó vừa xóa
       * hồ sơ ngay dưới chân lượt gán, và `?? null` ở đây sẽ lặng lẽ biến chuyện đó thành "trần
       * là null" — tức là bỏ qua trọn vẹn phép kiểm seat.
       */
      if (locked.length === 0) {
        throw new NotFoundException({
          code: 'SOFTWARE_NOT_FOUND',
          message: 'Hồ sơ phần mềm vừa bị xóa, không gán được.',
        });
      }
      /*
       * Loại, kỳ hạn và Thanh lý cũng đọc lại từ hàng đã khóa: kiểm ở đầu hàm dựa trên ảnh chụp
       * ngoài transaction, và một lượt thanh lý hay đổi loại commit vào giữa sẽ lọt qua.
       */
      if (locked[0].status === 'retired') {
        throw new ConflictException({
          code: 'SOFTWARE_RETIRED',
          message: 'Hồ sơ này đã thanh lý, không gán thêm máy được.',
        });
      }
      if (!supportsSeats(locked[0].kind as SoftwareKind)) {
        throw new BadRequestException({
          code: 'NOT_A_LICENSE',
          message: 'Chỉ hồ sơ loại License mới gán được vào máy.',
        });
      }
      assertTerms(terms, locked[0].licenseModel as LicenseModel);
      const seatTotal = locked[0].seatTotal;

      const used = await this.usedWithin(tx, softwareId);
      const warnings: string[] = [];
      if (seatTotal !== null && used >= seatTotal) {
        // AC 3.2: cho ghi đè nhưng PHẢI có lý do — vượt seat là chuyện pháp lý với nhà cung
        // cấp, không thể để lặng lẽ.
        if (!input.overSeatReason?.trim()) {
          throw new BadRequestException({
            code: 'SEAT_LIMIT_REACHED',
            message: `License này đã dùng hết ${seatTotal} ghế. Vẫn gán được nhưng phải ghi lý do.`,
          });
        }
        warnings.push(
          `Đang vượt số ghế: ${used + 1}/${seatTotal}. Lý do đã ghi vào lịch sử.`,
        );
      }

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
        throw conflictOnUnique(error, {
          code: 'ALREADY_ASSIGNED',
          message: 'License này đã được gán vào đúng máy đó rồi.',
        });
      }
      await this.software.recordWithin(tx, actor, softwareId, 'license-assigned', {
        deviceId: { before: null, after: input.deviceId },
        ...(input.overSeatReason
          ? { overSeatReason: { before: null, after: input.overSeatReason.trim() } }
          : {}),
      });
      return { id: inserted[0].id, warnings };
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
      /*
       * Cùng lý do với `release`: chỉ được sửa ghế CÒN HIỆU LỰC, và điều kiện đó phải nằm
       * trong câu UPDATE chứ không phải ở câu SELECT chạy trước đó ngoài transaction.
       *
       * Không có nó thì người A gỡ ghế trong lúc người B đang sửa kỳ hạn: bản ghi đã gỡ —
       * tức dấu vết lịch sử "key này từng nhập máy nào" — bị sửa chi phí/hợp đồng đè lên,
       * đúng điều chú thích của chính hàm này hứa là không được phép.
       */
      const updated = await tx
        .update(licenseAssignmentTable)
        .set({ ...terms, note })
        .where(
          and(
            eq(licenseAssignmentTable.id, assignmentId),
            isNull(licenseAssignmentTable.releasedAt),
          ),
        )
        .returning({ id: licenseAssignmentTable.id });
      requireCas(updated, {
        code: 'ASSIGNMENT_ALREADY_RELEASED',
        message: 'Ghế này vừa được người khác gỡ nên không sửa kỳ hạn được nữa. Tải lại để xem.',
      });
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

  /**
   * Gia hạn hồ sơ kéo theo ghế (SW-049): ghế CÒN HIỆU LỰC có kỳ hạn riêng nằm trong [hạn cũ,
   * hạn mới) được đặt tới hạn mới — không thì license đã gia hạn mà ghế vẫn hiện "Quá hạn". Ghế
   * kết thúc TRƯỚC hạn cũ là kỳ hạn người ta chủ ý đặt ngắn (vd nhà thầu), kéo theo là xoá mất
   * cảnh báo hết hạn của nó. Ghế đã gỡ là dấu vết kiểm toán, không sửa; ghế dài hạn hơn thì
   * không bị rút ngắn. License chưa có hạn cũ thì không có mốc, mọi ghế trước hạn mới đều kéo.
   *
   * Chạy trong transaction gia hạn của hồ sơ (`SoftwareService.renew`): một bên hỏng thì cả
   * hai cùng lùi. Mỗi ghế một dòng lịch sử kèm mã máy, như khi sửa kỳ hạn từng ghế.
   */
  async renewSeatsWithin(
    tx: Tx,
    actor: string,
    softwareId: string,
    oldEnd: string | null,
    newEnd: string,
  ): Promise<number> {
    const due = await tx
      .select({
        id: licenseAssignmentTable.id,
        deviceId: licenseAssignmentTable.deviceId,
        endDate: licenseAssignmentTable.endDate,
      })
      .from(licenseAssignmentTable)
      .where(
        and(
          eq(licenseAssignmentTable.softwareId, softwareId),
          isNull(licenseAssignmentTable.releasedAt),
          isNotNull(licenseAssignmentTable.endDate),
          lt(licenseAssignmentTable.endDate, newEnd),
          oldEnd ? gte(licenseAssignmentTable.endDate, oldEnd) : undefined,
        ),
      )
      .for('update');
    if (due.length === 0) return 0;
    const devices = await this.devices.getByIds([...new Set(due.map((row) => row.deviceId))]);
    for (const seat of due) {
      await tx
        .update(licenseAssignmentTable)
        .set({ endDate: newEnd })
        .where(eq(licenseAssignmentTable.id, seat.id));
      const code = devices.get(seat.deviceId)?.code ?? seat.deviceId;
      await this.software.recordWithin(tx, actor, softwareId, 'license-terms-updated', {
        device: { before: code, after: code },
        endDate: { before: seat.endDate, after: newEnd },
      });
    }
    return due.length;
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
      /*
       * `released_at IS NULL` đi cùng câu UPDATE — câu SELECT ở trên chạy ngoài transaction
       * này, nên một mình nó không chốt được gì.
       *
       * Gỡ hai lần cùng lúc (bấm đúp, hoặc hai người cùng mở màn): thiếu vị từ này thì lượt
       * thứ hai ghi đè `released_at` và ghi THÊM một dòng `software_history` "license-released"
       * nữa. Sổ lịch sử thành ra có hai lần gỡ cho một lần ngồi ghế — và bảng lịch sử là
       * chỉ-thêm (AD-13), không sửa lại được.
       */
      const released = await tx
        .update(licenseAssignmentTable)
        .set({ releasedAt: new Date(), releasedBy: actor })
        .where(
          and(
            eq(licenseAssignmentTable.id, assignmentId),
            isNull(licenseAssignmentTable.releasedAt),
          ),
        )
        .returning({ id: licenseAssignmentTable.id });
      requireCas(released, {
        code: 'ASSIGNMENT_ALREADY_RELEASED',
        message: 'Ghế này vừa được người khác gỡ. Tải lại để xem danh sách mới.',
      });
      await this.software.recordWithin(tx, actor, softwareId, 'license-released', {
        deviceId: { before: rows[0].deviceId, after: null },
      });
    });
  }

  /**
   * Trả MỌI ghế mà một thiết bị đang ngồi, TRONG transaction của lượt thanh lý máy.
   *
   * ===== GỠ KHỎI MÁY, KHÔNG THANH LÝ PHẦN MỀM =====
   *
   * Chỉ đóng `released_at` của dòng GÁN. Hồ sơ `software` không bị chạm tới một chữ: công ty
   * vẫn sở hữu cái license đó và sẽ gán cho máy mới. Đây là ranh giới dễ vượt nhất khi viết
   * "dọn tự động", và vượt qua nó là xoá tài sản của công ty vì một cú bấm thanh lý máy.
   *
   * ===== VÌ SAO PHẢI CÓ HÀM NÀY, THAY VÌ MỘT CÂU UPDATE HÀNG LOẠT =====
   *
   * Mỗi ghế vẫn phải để lại dòng `software_history` của riêng nó. Đó là chỗ trả lời "cái ghế
   * này ai từng ngồi, gỡ khi nào, vì sao" — câu hỏi khi rà license với nhà cung cấp. Một câu
   * `UPDATE ... WHERE device_id = ?` nhanh hơn nhưng để lại đúng con số 0 dòng lịch sử.
   *
   * Không dùng `requireCas` ở đây: `WHERE released_at IS NULL` đã lọc sẵn, và số hàng trúng là
   * "bao nhiêu ghế máy này đang ngồi" — 0 hay 5 đều hợp lệ, khác hẳn ngữ nghĩa của `release()`
   * (gỡ ĐÚNG một ghế người dùng chỉ định).
   */
  async releaseForDeviceWithin(
    tx: Tx,
    actor: string,
    deviceId: string,
    reason: string,
  ): Promise<void> {
    const released = await tx
      .update(licenseAssignmentTable)
      .set({ releasedAt: new Date(), releasedBy: actor })
      .where(
        and(
          eq(licenseAssignmentTable.deviceId, deviceId),
          isNull(licenseAssignmentTable.releasedAt),
        ),
      )
      .returning({
        id: licenseAssignmentTable.id,
        softwareId: licenseAssignmentTable.softwareId,
      });

    for (const row of released) {
      await this.software.recordWithin(tx, actor, row.softwareId, 'license-released', {
        deviceId: { before: deviceId, after: null },
        reason: { before: null, after: reason },
      });
    }
  }

  /** Mã máy để đọc, hoặc chính uuid nếu máy đã biến mất — không được để sập cả lời gọi. */
  private async deviceCodeOf(deviceId: string): Promise<string> {
    try {
      return (await this.devices.getById(deviceId)).code;
    } catch {
      return deviceId;
    }
  }

  /**
   * Gắn mã + tên thiết bị bằng MỘT lượt hỏi `devices.api`.
   *
   * Chú thích cũ ở đây viết đúng câu này — "(một lượt hỏi devices.api, không N+1)" — trong khi
   * code ngay bên dưới gọi `getById` cho TỪNG dòng. Một bảng gán 200 máy là 1600 truy vấn, và
   * dòng chữ đó là lý do không ai đi kiểm lại. Giữ lại ghi chú này để lần sau đọc chú thích
   * thì vẫn mở code ra xem.
   */
  private async decorate(
    rows: (typeof licenseAssignmentTable.$inferSelect)[],
  ): Promise<AssignmentRow[]> {
    const devices = await this.devices.getByIds(rows.map((row) => row.deviceId));
    const out: AssignmentRow[] = [];
    for (const row of rows) {
      let deviceCode = '(thiết bị không còn)';
      let deviceName = '';
      let deviceAssignedTo: string | null = null;
      const device = devices.get(row.deviceId);
      if (device) {
        deviceCode = device.code;
        deviceName = device.name;
        deviceAssignedTo = device.assignedTo;
      }
      // Vắng mặt = thiết bị bị xóa/dữ liệu hỏng. Không được để một bản ghi lạ làm sập cả bảng.
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

