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
} from '@nestjs/common';
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
import { DevicePortsService } from './device-ports.service';
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


class PortBodyDto {
  @IsOptional() @IsString() @Length(1, 60) portLabel?: string;

  // Chuỗi rỗng = gỡ liên kết tới thiết bị trong kho (đầu kia thành mô tả tự do).
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() connectedDeviceId?: string;

  @IsOptional() @IsString() @Length(0, 200) connectedLabel?: string;
  @IsOptional() @IsString() @Length(0, 60) connectedPort?: string;
  @IsOptional() @IsString() @Length(0, 120) usedBy?: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

class PortParamDto extends IdParamDto {
  @IsUUID(undefined, { message: 'Mã dòng port map không hợp lệ.' })
  portId!: string;
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
  constructor(
    private readonly devices: DevicesService,
    private readonly ports: DevicePortsService,
  ) {}

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
  // ───────────── Port map (story 2.4, AD-14) ─────────────

  /**
   * Trả CẢ HAI CHIỀU: `ports` là cổng của chính thiết bị này, `incoming` là cổng ở nơi khác
   * đang cắm vào nó — dựng bằng query, không có bản ghi đối xứng nào trong DB (AD-14).
   */
  @Roles('sa', 'admin', 'member')
  @Get(':id/ports')
  listPorts(@Param() params: IdParamDto) {
    return this.ports.listFor(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Post(':id/ports')
  @Audited('device.port.added', 'device')
  addPort(
    @Param() params: IdParamDto,
    @Body() body: PortBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.ports.create(actor(req), params.id, body);
  }

  @Roles('sa', 'admin', 'member')
  @Patch(':id/ports/:portId')
  @Audited('device.port.updated', 'device')
  updatePort(
    @Param() params: PortParamDto,
    @Body() body: PortBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.ports.update(actor(req), params.id, params.portId, body);
  }

  @Roles('sa', 'admin', 'member')
  @Delete(':id/ports/:portId')
  @Audited('device.port.removed', 'device')
  async removePort(@Param() params: PortParamDto, @Req() req: AuthedRequest) {
    await this.ports.remove(actor(req), params.id, params.portId);
    return { status: 'deleted' };
  }
}

function actor(req: AuthedRequest): string {
  return req.user!.email;
}
