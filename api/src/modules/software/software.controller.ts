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
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
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
  type LicenseModel,
  type SoftwareKind,
  type SoftwareStatus,
} from './software-rules';
import { LicenseAssignmentService } from './license-assignment.service';
import {
  SOFTWARE_SORT_DEFAULT,
  SOFTWARE_SORT_KEYS,
  SoftwareService,
} from './software.service';
import { NoStepUp } from '../auth/step-up.decorator';

/** Ngày lịch dạng YYYY-MM-DD; chuỗi rỗng nghĩa là XÓA ngày đang có. */
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})?$/;

/** Lọc mã máy rác khỏi danh sách `?deviceIds=` trước khi đưa xuống truy vấn. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class SoftwareBodyDto {
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

  @IsOptional() @ValidateIf((_o, value) => value !== null) @IsInt() @Min(1)
  seatTotal?: number | null;

  @IsOptional() @Matches(DATE_ONLY, { message: 'Ngày bắt đầu phải dạng YYYY-MM-DD.' })
  startDate?: string;

  @IsOptional() @Matches(DATE_ONLY, { message: 'Ngày hết hạn phải dạng YYYY-MM-DD.' })
  endDate?: string;

  @IsOptional() @IsString() @Length(0, 2000) note?: string;

  @IsOptional()
  @IsIn([...SOFTWARE_STATUSES], { message: 'Trạng thái hồ sơ không hợp lệ.' })
  status?: SoftwareStatus;
}

class RenewDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Hạn mới phải dạng YYYY-MM-DD.' })
  endDate!: string;
}

/**
 * Kỳ hạn + chi phí RIÊNG của một ghế (0027). Dùng chung cho lúc gán và lúc sửa: hai bản DTO
 * riêng sẽ trôi khác nhau đúng vào lúc luật đổi.
 */
class AssignmentTermsDto {
  /**
   * Tiền đồng, số nguyên. `null` = xóa giá trị đang có; service kiểm giới hạn trên
   * (`Number.MAX_SAFE_INTEGER`) vì cột là bigint, quá ngưỡng thì JS đọc ra số khác.
   */
  @IsOptional() @ValidateIf((_o, value) => value !== null) @IsInt() @Min(0)
  cost?: number | null;

  @IsOptional() @IsString() @Length(0, 200) contract?: string;

  @IsOptional() @Matches(DATE_ONLY, { message: 'Ngày bắt đầu của ghế phải dạng YYYY-MM-DD.' })
  startDate?: string;

  @IsOptional() @Matches(DATE_ONLY, { message: 'Ngày kết thúc của ghế phải dạng YYYY-MM-DD.' })
  endDate?: string;

  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

class AssignDto extends AssignmentTermsDto {
  @IsUUID(undefined, { message: 'Thiết bị được chọn không hợp lệ.' })
  deviceId!: string;

  /** Bắt buộc khi vượt seat (AC 3.2) — service kiểm, DTO chỉ giới hạn độ dài. */
  @IsOptional() @IsString() @Length(0, 500) overSeatReason?: string;
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
 * Hồ sơ phần mềm (story 3.1, FR-008/FR-009).
 *
 * Quyền: giống kho thiết bị — cả team IT đọc và ghi được, vì đây là việc hằng ngày.
 * Thứ cần siết là KÉT SẮT (Epic 4): key/mật khẩu KHÔNG nằm trong module này.
 */
@NoStepUp()
@Controller('api/v1/software')
export class SoftwareController {
  constructor(
    private readonly software: SoftwareService,
    private readonly assignments: LicenseAssignmentService,
    private readonly excel: ExcelExportService,
  ) {}

  @Roles('sa', 'admin', 'member')
  @Get()
  list(
    @Query()
    query: {
      page?: string;
      limit?: string;
      search?: string;
      kind?: SoftwareKind;
      status?: SoftwareStatus;
      vendorId?: string;
      sort?: string;
      dir?: string;
    },
  ) {
    return this.software.list(
      parsePageQuery(query),
      {
        search: query.search,
        kind: query.kind,
        status: query.status,
        vendorId: query.vendorId,
      },
      parseSortQuery(query, SOFTWARE_SORT_KEYS, SOFTWARE_SORT_DEFAULT),
    );
  }

  /**
   * FR-028 / AC 7.2: xuất đúng bộ lọc đang xem.
   *
   * Khai báo TRƯỚC `@Get(':id')` — Nest khớp route theo thứ tự, để sau thì `export.xlsx` bị
   * `:id` nuốt mất và trả về 400 vì không phải uuid.
   *
   * Cột KHÔNG có chỗ nào cho key/mật khẩu: hồ sơ phần mềm không giữ chúng (Epic 3), và két
   * sắt thì tuyệt đối không có đường xuất (FR-026).
   */
  @Roles('sa', 'admin', 'member')
  @Audited('software.exported', 'software')
  @Get('export.xlsx')
  async export(
    @Query()
    query: {
      search?: string;
      kind?: SoftwareKind;
      status?: SoftwareStatus;
      vendorId?: string;
      sort?: string;
      dir?: string;
    },
    @Res() res: Response,
  ) {
    /**
     * `listAll` chứ không phải `list({ limit: N })`.
     *
     * Cắt ở 5000 dòng thì người dùng nhận một file TRÔNG NHƯ đầy đủ mà thiếu phần đuôi, và
     * không có gì báo. `SoftwareService.listAll` đã có sẵn và ghi rõ trong doc là "chỉ dùng
     * cho export xlsx (FR-028)" — tôi đã không đọc trước khi viết (code review Epic 7).
     */
    const rows = await this.software.listAll(
      {
        search: query.search,
        kind: query.kind,
        status: query.status,
        vendorId: query.vendorId,
      },
      parseSortQuery(query, SOFTWARE_SORT_KEYS, SOFTWARE_SORT_DEFAULT),
    );
    const buffer = await this.excel.build({
      sheetName: 'Phan mem',
      columns: [
        { header: 'Mã hồ sơ', width: 20, value: (r) => r.code },
        { header: 'Tên', width: 32, value: (r) => r.name },
        { header: 'Loại', width: 16, value: (r) => KIND_LABEL[r.kind] },
        { header: 'Nhà cung cấp', width: 22, value: (r) => r.vendorName ?? '' },
        { header: 'Seat dùng/tổng', width: 14, value: (r) => seatText(r) },
        { header: 'Bắt đầu', width: 14, value: (r) => r.startDate ?? '' },
        { header: 'Hết hạn', width: 14, value: (r) => r.endDate ?? '' },
        { header: 'Trạng thái', width: 18, value: (r) => STATUS_LABEL[r.status] },
        { header: 'Ghi chú', width: 40, value: (r) => r.note ?? '' },
      ],
      rows,
    });
    sendXlsx(res, buffer, 'phan-mem.xlsx');
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
    return this.software.findOne(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Get(':id/history')
  history(@Param() params: IdParamDto) {
    return this.software.history(params.id);
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
    return this.software.renew(actor(req), params.id, body.endDate);
  }

  // ───────────── Gán license vào máy (story 3.2, FR-011) ─────────────

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
   * Sửa kỳ hạn / chi phí / hợp đồng / ghi chú của MỘT ghế (0027).
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
