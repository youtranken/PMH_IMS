import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
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
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import {
  SOFTWARE_KINDS,
  SOFTWARE_STATUSES,
  type SoftwareKind,
  type SoftwareStatus,
} from './software-rules';
import { SoftwareService } from './software.service';

/** Ngày lịch dạng YYYY-MM-DD; chuỗi rỗng nghĩa là XÓA ngày đang có. */
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})?$/;

class SoftwareBodyDto {
  @IsOptional() @IsString() @Length(1, 60) code?: string;
  @IsOptional() @IsString() @Length(1, 200) name?: string;

  @IsOptional()
  @IsIn([...SOFTWARE_KINDS], { message: 'Loại hồ sơ không hợp lệ.' })
  kind?: SoftwareKind;

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
@Controller('api/v1/software')
export class SoftwareController {
  constructor(private readonly software: SoftwareService) {}

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
    },
  ) {
    return this.software.list(parsePageQuery(query), {
      search: query.search,
      kind: query.kind,
      status: query.status,
      vendorId: query.vendorId,
    });
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
}

function actor(req: AuthedRequest): string {
  return req.user!.email;
}
