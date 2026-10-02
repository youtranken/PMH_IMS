import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  Validate,
  ValidateIf,
} from 'class-validator';
import { NoSecretText } from '../../common/no-secret-text';
import { RealDate, RealDateOrEmpty } from '../../common/real-date';
import { parsePageQuery } from '../../common/pagination';
import { parseSortQuery } from '../../common/sorting';
import { Audited } from '../audit/audited.decorator';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { sendXlsx } from '../../common/excel/xlsx-http';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import {
  KIND_LABEL,
  STATUS_LABEL,
  LICENSE_MODELS,
  SOFTWARE_KINDS,
  SOFTWARE_STATUSES,
  softwareExportShape,
  softwareKindsQuery,
  softwareStatusQuery,
  type LicenseModel,
  type SoftwareKind,
  type SoftwareStatus,
} from './software-rules';
import { LicenseAssignmentService } from './license-assignment.service';
import { SoftwareExportQueryDto, SoftwareListQueryDto } from './list-query.dto';
import {
  SOFTWARE_SORT_DEFAULT,
  SOFTWARE_SORT_KEYS,
  SoftwareService,
} from './software.service';
import type { SoftwareFilter } from './software.types';
import { deviceIdsInHistory, withDeviceCodes } from './history-device-codes';
import { withActorNames } from '../../common/history';
import { UsersApiService } from '../users/users.api';
import { SystemConfigService } from '../config-sys/system-config.service';
import { assignmentExportSheet } from './license-assignments-export';
import { NoStepUp } from '../auth/step-up.decorator';

/** Lọc mã máy rác khỏi danh sách `?deviceIds=` trước khi đưa xuống truy vấn. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SoftwareBodyDto {
  @IsOptional() @IsString() @Length(1, 60) code?: string;
  @IsOptional() @IsString() @Length(1, 200) name?: string;

  @IsOptional()
  @IsIn([...SOFTWARE_KINDS], { message: 'Loại hồ sơ không hợp lệ.' })
  kind?: SoftwareKind;

  @IsOptional()
  @IsIn([...LICENSE_MODELS], { message: 'Kỳ hạn phải là thuê bao hoặc vĩnh viễn.' })
  licenseModel?: LicenseModel;

  // Chuỗi rỗng = bỏ gán nhà cung cấp, nên không ép UUID trong trường hợp đó.
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() vendorId?: string;

  @IsOptional() @ValidateIf((_o, value) => value !== null) @Min(1) @IsInt()
  seatTotal?: number | null;

  @IsOptional() @Validate(RealDateOrEmpty, { message: 'Ngày bắt đầu phải là ngày có thật, dạng YYYY-MM-DD.' })
  startDate?: string;

  @IsOptional() @Validate(RealDateOrEmpty, { message: 'Ngày hết hạn phải là ngày có thật, dạng YYYY-MM-DD.' })
  endDate?: string;

  @IsOptional() @IsString() @Length(0, 2000) @NoSecretText() note?: string;

  @IsOptional()
  @IsIn([...SOFTWARE_STATUSES], { message: 'Trạng thái hồ sơ không hợp lệ.' })
  status?: SoftwareStatus;

  /** Website dùng chứng chỉ SSL / tên miền này (Q-15). Service chuẩn hóa + kiểm từng dòng. */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @Length(0, 300, { each: true })
  websites?: string[];
}

class RenewDto {
  @Validate(RealDate, { message: 'Hạn mới phải là ngày có thật, dạng YYYY-MM-DD.' })
  endDate!: string;

  /** SW-049: kéo luôn các ghế có kỳ hạn riêng kết thúc trước hạn mới. */
  @IsOptional() @IsBoolean() seats?: boolean;

  /** Hợp đồng của RIÊNG lượt gia hạn này — ghi vào sổ gia hạn, không vào hồ sơ (Q-15). */
  @IsOptional() @IsString() @Length(0, 200) contract?: string;

  /** Tiền đồng, số nguyên; `null`/bỏ trống = chưa khai. Service kiểm trần 2^53. */
  @IsOptional() @ValidateIf((_o, value) => value !== null) @Min(0) @IsInt()
  cost?: number | null;

  /** SSL/tên miền: danh sách website của kỳ mới; bỏ trống = giữ danh sách đang có (Q-15). */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @Length(0, 300, { each: true })
  websites?: string[];
}

/**
 * Kỳ hạn + chi phí RIÊNG của một ghế. Dùng chung cho lúc gán và lúc sửa: hai bản DTO
 * riêng sẽ trôi khác nhau đúng vào lúc luật đổi.
 */
class AssignmentTermsDto {
  /**
   * Tiền đồng, số nguyên. `null` = xóa giá trị đang có; service kiểm giới hạn trên
   * (`Number.MAX_SAFE_INTEGER`) vì cột là bigint, quá ngưỡng thì JS đọc ra số khác.
   */
  @IsOptional() @ValidateIf((_o, value) => value !== null) @Min(0) @IsInt()
  cost?: number | null;

  @IsOptional() @IsString() @Length(0, 200) contract?: string;

  @IsOptional() @Validate(RealDateOrEmpty, { message: 'Ngày bắt đầu của ghế phải là ngày có thật, dạng YYYY-MM-DD.' })
  startDate?: string;

  @IsOptional() @Validate(RealDateOrEmpty, { message: 'Ngày kết thúc của ghế phải là ngày có thật, dạng YYYY-MM-DD.' })
  endDate?: string;

  @IsOptional() @IsString() @Length(0, 500) @NoSecretText() note?: string;
}

export class AssignDto extends AssignmentTermsDto {
  @IsUUID(undefined, { message: 'Thiết bị được chọn không hợp lệ.' })
  deviceId!: string;

  /** Bắt buộc khi vượt seat (AC 3.2) — service kiểm, DTO chỉ giới hạn độ dài. */
  @IsOptional() @IsString() @Length(0, 500) @NoSecretText('Lý do vượt số ghế') overSeatReason?: string;
}

class DeviceIdsQueryDto {
  /** Danh sách mã máy ngăn bởi dấu phẩy — một lượt hỏi cho cả trang, không N+1. */
  @IsOptional() @IsString() @Length(0, 2000) deviceIds?: string;
}

class DeviceIdParamDto {
  @IsUUID(undefined, { message: 'Mã thiết bị không hợp lệ.' })
  deviceId!: string;
}

class AssignmentParamDto {
  @IsUUID(undefined, { message: 'Mã hồ sơ không hợp lệ.' })
  id!: string;

  @IsUUID(undefined, { message: 'Mã bản ghi gán không hợp lệ.' })
  assignmentId!: string;
}

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã hồ sơ không hợp lệ.' })
  id!: string;
}

/**
 * Hồ sơ phần mềm (FR-008/FR-009).
 *
 * Quyền: giống kho thiết bị — cả team IT đọc và ghi được, vì đây là việc hằng ngày.
 * Thứ cần siết là KÉT SẮT: key/mật khẩu KHÔNG nằm trong module này.
 */
@NoStepUp()
@Controller('api/v1/software')
export class SoftwareController {
  constructor(
    private readonly software: SoftwareService,
    private readonly assignments: LicenseAssignmentService,
    private readonly excel: ExcelExportService,
    private readonly users: UsersApiService,
    private readonly config: SystemConfigService,
  ) {}

  /**
   * Bộ lọc CHUNG của danh sách và file xuất (FR-028) — hai chỗ dựng riêng thì file tải về lệch
   * cái đang nhìn. Giá trị lạ trên URL bị bỏ qua thay vì lọt xuống câu truy vấn.
   */
  private async filterOf(
    query: {
      search?: string;
      kind?: string;
      licenseModel?: LicenseModel;
      status?: SoftwareStatus | 'live';
      vendorId?: string;
    },
    deviceMatches?: Map<string, string[]>,
  ): Promise<SoftwareFilter> {
    const search = query.search?.trim();
    return {
      search,
      alsoIds: search
        ? deviceMatches
          ? [...deviceMatches.keys()]
          : await this.assignments.softwareIdsOnDevices(search)
        : undefined,
      kinds: softwareKindsQuery(query.kind),
      licenseModel: LICENSE_MODELS.includes(query.licenseModel as LicenseModel)
        ? query.licenseModel
        : undefined,
      status: softwareStatusQuery(query.status),
      vendorId: query.vendorId,
    };
  }

  @Roles('sa', 'admin', 'member')
  @Get()
  async list(
    @Query() query: SoftwareListQueryDto,
  ) {
    const search = query.search?.trim();
    const matches = search
      ? await this.assignments.devicesHoldingSeats(search)
      : new Map<string, string[]>();
    const page = await this.software.list(
      parsePageQuery(query),
      await this.filterOf(query, matches),
      parseSortQuery(query, SOFTWARE_SORT_KEYS, SOFTWARE_SORT_DEFAULT),
    );
    const items = await this.software.present(page.items);
    return {
      ...page,
      // SW-010: hồ sơ hiện ra vì MÁY đang giữ ghế khớp ô tìm → mã máy cho chip "khớp máy X".
      items: items.map((item) => ({ ...item, matchedDevices: matches.get(item.id) ?? [] })),
    };
  }

  /**
   * FR-028 / AC 7.2: xuất đúng bộ lọc đang xem.
   *
   * Khai báo TRƯỚC `@Get(':id')` — Nest khớp route theo thứ tự, để sau thì `export.xlsx` bị
   * `:id` nuốt mất và trả về 400 vì không phải uuid.
   *
   * Cột KHÔNG có chỗ nào cho key/mật khẩu: hồ sơ phần mềm không giữ chúng, và két
   * sắt thì tuyệt đối không có đường xuất (FR-026).
   */
  @Roles('sa', 'admin', 'member')
  @Audited('software.exported', 'software')
  @Get('export.xlsx')
  async export(
    @Query() query: SoftwareExportQueryDto,
    @Res() res: Response,
  ) {
    /**
     * `listAll` chứ không phải `list({ limit: N })`.
     *
     * Cắt ở 5000 dòng thì người dùng nhận một file TRÔNG NHƯ đầy đủ mà thiếu phần đuôi, và
     * không có gì báo. `SoftwareService.listAll` đã có sẵn và ghi rõ trong doc là "chỉ dùng
     * cho export xlsx (FR-028)".
     */
    const filter = await this.filterOf(query);
    const rows = await this.software.listAll(
      filter,
      parseSortQuery(query, SOFTWARE_SORT_KEYS, SOFTWARE_SORT_DEFAULT),
    );
    // Mỗi màn chỉ xuất cột của loại nó (Q-22) — xem `softwareExportShape`.
    const shape = softwareExportShape(filter.kinds);
    type Row = (typeof rows)[number];
    const columns: { header: string; width: number; value: (r: Row) => string }[] = [
      { header: 'Mã hồ sơ', width: 20, value: (r) => r.code },
      { header: 'Tên', width: 32, value: (r) => r.name },
      { header: 'Loại', width: 16, value: (r) => KIND_LABEL[r.kind] },
      { header: 'Nhà cung cấp', width: 22, value: (r) => r.vendorName ?? '' },
      ...(shape.seats
        ? [{ header: 'Ghế dùng/tổng', width: 14, value: (r: Row) => seatText(r) }]
        : []),
      { header: 'Bắt đầu', width: 14, value: (r) => r.startDate ?? '' },
      { header: 'Hết hạn', width: 14, value: (r) => r.endDate ?? '' },
      { header: 'Trạng thái', width: 18, value: (r) => STATUS_LABEL[r.status] },
      // Q-22: một hồ sơ = các tên miền dùng chung một ngày hết hạn — cùng danh sách với hồ sơ.
      ...(shape.websites
        ? [{ header: 'Tên miền', width: 36, value: (r: Row) => (r.websites ?? []).join(', ') }]
        : []),
      { header: 'Ghi chú', width: 40, value: (r) => r.note ?? '' },
    ];
    const buffer = await this.excel.build({ sheetName: shape.sheetName, columns, rows });
    sendXlsx(res, buffer, shape.fileName);
  }

  /**
   * Có bao nhiêu license đang cài trên mỗi máy — danh sách thiết bị hỏi một lượt cho cả
   * trang để biết dòng nào đáng mọc mũi tên bung (mũi tên bấm ra rỗng là một kiểu hứa hão).
   *
   * Đặt dưới tiền tố `installed/` và khai TRƯỚC `@Get(':id')`: Nest khớp route theo thứ tự,
   * để sau thì `:id` nuốt mất và trả 400 vì không phải uuid — đúng cái bẫy đã sập với
   * `export.xlsx`. `counts` khai trước `:deviceId` cũng vì lý do đó.
   */
  @Roles('sa', 'admin', 'member')
  @Get('installed/counts')
  async installedCounts(@Query() query: DeviceIdsQueryDto) {
    const ids = (query.deviceIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => UUID_RE.test(id));
    const counts = await this.assignments.installedCountsFor(ids);
    return Object.fromEntries(counts);
  }

  /** Máy này đang cài license nào — khu bung dòng của danh sách thiết bị. */
  @Roles('sa', 'admin', 'member')
  @Get('installed/:deviceId')
  installedForDevice(@Param() params: DeviceIdParamDto) {
    return this.assignments.installedForDevice(params.deviceId);
  }

  @Roles('sa', 'admin', 'member')
  @Get(':id')
  findOne(@Param() params: IdParamDto) {
    return this.software.detail(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Get(':id/history')
  async history(@Param() params: IdParamDto) {
    const rows = await this.software.history(params.id);
    return withActorNames(
      withDeviceCodes(rows, await this.assignments.deviceCodes(deviceIdsInHistory(rows))),
      (emails) => this.users.namesByEmails(emails),
    );
  }

  @Roles('sa', 'admin', 'member')
  @Post()
  @Audited('software.created', 'software', { writtenByService: true })
  create(@Body() body: SoftwareBodyDto, @Req() req: AuthedRequest) {
    return this.software.create(actor(req), body);
  }

  @Roles('sa', 'admin', 'member')
  @Patch(':id')
  @Audited('software.updated', 'software', { writtenByService: true })
  update(
    @Param() params: IdParamDto,
    @Body() body: SoftwareBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.software.update(actor(req), params.id, body);
  }

  /** Gia hạn tách riêng khỏi sửa hồ sơ để lịch sử đọc ra "đã gia hạn tới ngày X". */
  @Roles('sa', 'admin', 'member')
  @Post(':id/renew')
  @Audited('software.renewed', 'software', { writtenByService: true })
  renew(@Param() params: IdParamDto, @Body() body: RenewDto, @Req() req: AuthedRequest) {
    const who = actor(req);
    return this.software.renew(
      who,
      params.id,
      body.endDate,
      body.seats
        ? (tx, oldEnd) =>
            this.assignments.renewSeatsWithin(tx, who, params.id, oldEnd, body.endDate)
        : undefined,
      { contract: body.contract, cost: body.cost, websites: body.websites },
    );
  }

  /**
   * Sổ gia hạn của hồ sơ: từng lượt với hạn cũ → mới, hợp đồng, chi phí (Q-15). Kèm họ tên người
   * gia hạn như màn Sắp hết hạn — một người không mang hai cách gọi ở hai màn.
   */
  @Roles('sa', 'admin', 'member')
  @Get(':id/renewals')
  async renewals(@Param() params: IdParamDto) {
    return withActorNames(await this.software.renewals(params.id), (emails) =>
      this.users.namesByEmails(emails),
    );
  }

  // ───────────── Gán license vào máy (FR-011) ─────────────

  /**
   * Máy ĐANG dùng license này ra Excel, kèm dòng tổng chi phí — file nộp kiểm toán (SW-057).
   * Khai trước `:id/assignments` cho dễ đọc; hai route khác số đoạn nên không nuốt nhau.
   */
  @Roles('sa', 'admin', 'member')
  @Audited('software.assignments.exported', 'software')
  @Get(':id/assignments/export.xlsx')
  async exportAssignments(@Param() params: IdParamDto, @Res() res: Response) {
    const item = await this.software.detail(params.id);
    const sheet = assignmentExportSheet(
      await this.assignments.listFor(params.id, false),
      await this.config.getString('appTimezone'),
    );
    const buffer = await this.excel.build({ sheetName: 'Máy đang dùng', ...sheet });
    sendXlsx(res, buffer, `may-dang-dung-${item.code}.xlsx`);
  }

  /** `includeReleased=true` mở cả dòng đã gỡ — "key này từng nhập máy nào" là câu kiểm toán. */
  @Roles('sa', 'admin', 'member')
  @Get(':id/assignments')
  listAssignments(
    @Param() params: IdParamDto,
    @Query('includeReleased') includeReleased?: string,
  ) {
    return this.assignments.listFor(params.id, includeReleased === 'true');
  }

  @Roles('sa', 'admin', 'member')
  @Post(':id/assignments')
  @Audited('software.license-assigned', 'software', { writtenByService: true })
  assign(@Param() params: IdParamDto, @Body() body: AssignDto, @Req() req: AuthedRequest) {
    return this.assignments.assign(actor(req), params.id, body);
  }

  /**
   * Sửa kỳ hạn / chi phí / hợp đồng / ghi chú của MỘT ghế.
   *
   * Tách khỏi `PATCH :id` (sửa hồ sơ) vì đây là dữ liệu của một chỗ ngồi cụ thể: cùng một
   * license, ghế của Kế toán và ghế của Xưởng có hợp đồng và giá khác nhau.
   */
  @Roles('sa', 'admin', 'member')
  @Patch(':id/assignments/:assignmentId')
  @Audited('software.license-terms-updated', 'software', { writtenByService: true })
  updateAssignment(
    @Param() params: AssignmentParamDto,
    @Body() body: AssignmentTermsDto,
    @Req() req: AuthedRequest,
  ) {
    return this.assignments.updateTerms(actor(req), params.id, params.assignmentId, body);
  }

  /** Gỡ gán = đánh dấu released, KHÔNG xóa dòng (AC 3.2). */
  @Roles('sa', 'admin', 'member')
  @Delete(':id/assignments/:assignmentId')
  @Audited('software.license-released', 'software', { writtenByService: true })
  async release(@Param() params: AssignmentParamDto, @Req() req: AuthedRequest) {
    await this.assignments.release(actor(req), params.id, params.assignmentId);
    return { status: 'released' };
  }
}

function actor(req: AuthedRequest): string {
  return req.user!.email;
}

function seatText(row: { seatTotal: number | null; seatUsed: number | null }): string {
  if (row.seatTotal === null) return '';
  return `${row.seatUsed ?? 0}/${row.seatTotal}`;
}
