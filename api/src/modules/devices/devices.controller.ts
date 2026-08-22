import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { parsePageQuery } from '../../common/pagination';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { DevicesService } from './devices.service';
import { DEVICE_STATUSES, type DeviceStatus } from './devices.types';

/** Ngày lịch dạng YYYY-MM-DD; chuỗi rỗng nghĩa là XÓA ngày đang có. */
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})?$/;

class DeviceBodyDto {
  @IsOptional() @IsString() @Length(1, 60) code?: string;
  @IsOptional() @IsString() @Length(1, 200) name?: string;
  @IsOptional() @IsUUID() deviceTypeId?: string;
  @IsOptional() @IsString() @Length(0, 120) model?: string;
  @IsOptional() @IsString() @Length(0, 120) serial?: string;

  // Chuỗi rỗng = bỏ gán (thiết bị không nằm trong tủ, chưa biết NCC…), nên không ép UUID.
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() siteId?: string;
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() cabinetId?: string;
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() vendorId?: string;

  @IsOptional() @IsString() @Length(0, 120) assignedTo?: string;
  @IsOptional() @IsString() @Length(0, 120) department?: string;

  @IsOptional() @Matches(DATE_ONLY, { message: 'Ngày mua phải dạng YYYY-MM-DD.' })
  purchaseDate?: string;

  @IsOptional() @Matches(DATE_ONLY, { message: 'Ngày bắt đầu bảo hành phải dạng YYYY-MM-DD.' })
  warrantyStart?: string;

  @IsOptional() @Matches(DATE_ONLY, { message: 'Ngày hết bảo hành phải dạng YYYY-MM-DD.' })
  warrantyEnd?: string;

  @IsOptional()
  @IsIn([...DEVICE_STATUSES], { message: 'Trạng thái thiết bị không hợp lệ.' })
  status?: DeviceStatus;

  @IsOptional() @IsString() @Length(0, 2000) note?: string;
}

class StatusDto {
  @IsIn([...DEVICE_STATUSES], { message: 'Trạng thái thiết bị không hợp lệ.' })
  status!: DeviceStatus;
}

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã thiết bị không hợp lệ.' })
  id!: string;
}

/**
 * Kho thiết bị (story 2.2, FR-001/FR-007).
 *
 * Quyền: mọi vai đã đăng nhập đều ĐỌC và GHI được hồ sơ thiết bị — đây là việc hàng ngày
 * của cả team IT (story viết "As a Member"). Thứ chỉ Admin/SA đụng là DANH MỤC.
 * Không có endpoint DELETE: thiết bị chỉ đổi trạng thái sang "đã thanh lý".
 */
@Controller('api/v1/devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Roles('sa', 'admin', 'member')
  @Get()
  list(
    @Query()
    query: {
      page?: string;
      limit?: string;
      search?: string;
      siteId?: string;
      cabinetId?: string;
      deviceTypeId?: string;
      status?: DeviceStatus;
    },
  ) {
    return this.devices.list(parsePageQuery(query), {
      search: query.search,
      siteId: query.siteId,
      cabinetId: query.cabinetId,
      deviceTypeId: query.deviceTypeId,
      status: query.status,
    });
  }

  @Roles('sa', 'admin', 'member')
  @Get(':id')
  findOne(@Param() params: IdParamDto) {
    return this.devices.findOne(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Get(':id/history')
  history(@Param() params: IdParamDto) {
    return this.devices.history(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Post()
  @Audited('device.created', 'device')
  create(@Body() body: DeviceBodyDto, @Req() req: AuthedRequest) {
    return this.devices.create(actor(req), body);
  }

  @Roles('sa', 'admin', 'member')
  @Patch(':id')
  @Audited('device.updated', 'device')
  update(
    @Param() params: IdParamDto,
    @Body() body: DeviceBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.devices.update(actor(req), params.id, body);
  }

  @Roles('sa', 'admin', 'member')
  @Patch(':id/status')
  @Audited('device.status.changed', 'device')
  async setStatus(
    @Param() params: IdParamDto,
    @Body() body: StatusDto,
    @Req() req: AuthedRequest,
  ) {
    await this.devices.setStatus(actor(req), params.id, body.status);
    return { status: body.status };
  }
}

function actor(req: AuthedRequest): string {
  return req.user!.email;
}
