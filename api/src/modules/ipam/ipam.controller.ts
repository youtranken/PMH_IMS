import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { IpAddressService } from './ip-address.service';
import { IP_LIFECYCLE_STATUSES, type IpStatus } from './ip-lifecycle';
import { SubnetService } from './subnet.service';

/** Ngày lịch dạng YYYY-MM-DD; chuỗi rỗng nghĩa là XÓA ngày đang có. */
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})?$/;

class SubnetBodyDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsString() @Length(1, 43) cidr?: string;
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() siteId?: string;
  @IsOptional() @IsString() @Length(0, 500) description?: string;
}

class IpBodyDto {
  @IsOptional() @IsUUID(undefined, { message: 'Mã dải không hợp lệ.' }) subnetId?: string;
  @IsOptional() @IsString() @Length(1, 15) address?: string;
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() deviceId?: string;
  @IsOptional() @IsString() @Length(0, 160) usedBy?: string;

  @IsOptional() @Matches(DATE_ONLY, { message: 'Ngày cấp phải dạng YYYY-MM-DD.' })
  assignedAt?: string;

  @IsOptional() @IsString() @Length(0, 2000) note?: string;
}

class TransitionDto {
  @IsIn([...IP_LIFECYCLE_STATUSES], { message: 'Trạng thái đích không hợp lệ.' })
  to!: IpStatus;

  @IsOptional() @IsString() @Length(0, 500) reason?: string;

  // Cấp / cấp lại thường đi kèm chủ mới — nhận luôn để lịch sử ghi thành MỘT dòng.
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() deviceId?: string;
  @IsOptional() @IsString() @Length(0, 160) usedBy?: string;
}

/** Ẩn bản ghi nhập nhầm — LUÔN phải có lý do (quyết định 2026-08-23). */
class VoidDto {
  @IsString() @Length(3, 500) reason!: string;
}

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã không hợp lệ.' })
  id!: string;
}

/**
 * Dải mạng và hồ sơ IP (story 5.1, FR-018/FR-019/FR-020).
 *
 * Quyền: khai/sửa/ẩn DẢI là việc của Admin — dải khai sai kéo theo mọi IP bên trong sai.
 * Còn hồ sơ IP thì cả team IT làm được: người cắm máy chính là người biết IP nào vừa cấp,
 * bắt họ chờ Admin duyệt thì cuốn sổ sẽ lại quay về file Excel trên máy ai đó.
 */
@Controller('api/v1/ipam')
export class IpamController {
  constructor(
    private readonly subnets: SubnetService,
    private readonly addresses: IpAddressService,
  ) {}

  // --- Dải mạng ---------------------------------------------------------------

  @Roles('sa', 'admin', 'member')
  @Get('subnets')
  listSubnets() {
    return this.subnets.list();
  }

  @Roles('sa', 'admin', 'member')
  @Get('subnets/:id')
  findSubnet(@Param() params: IdParamDto) {
    return this.subnets.findOne(params.id);
  }

  /** Toàn bộ dải: IP đã có hồ sơ + ô còn trống (AC 5.1). */
  @Roles('sa', 'admin', 'member')
  @Get('subnets/:id/addresses')
  listSlots(@Param() params: IdParamDto) {
    return this.addresses.listBySubnet(params.id);
  }

  @Roles('sa', 'admin')
  @Post('subnets')
  @Audited('subnet.created', 'subnet', { writtenByService: true })
  createSubnet(@Body() body: SubnetBodyDto, @Req() req: AuthedRequest) {
    return this.subnets.create(actor(req), {
      name: body.name ?? '',
      cidr: body.cidr ?? '',
      siteId: body.siteId,
      description: body.description,
    });
  }

  @Roles('sa', 'admin')
  @Patch('subnets/:id')
  @Audited('subnet.updated', 'subnet', { writtenByService: true })
  updateSubnet(
    @Param() params: IdParamDto,
    @Body() body: SubnetBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.subnets.update(actor(req), params.id, body);
  }

  /** "Xóa" = ẩn kèm lý do. Bản ghi ở lại, tra cứu được, còn vết ai ẩn. */
  @Roles('sa', 'admin')
  @Delete('subnets/:id')
  @Audited('subnet.voided', 'subnet', { writtenByService: true })
  async voidSubnet(
    @Param() params: IdParamDto,
    @Body() body: VoidDto,
    @Req() req: AuthedRequest,
  ) {
    await this.subnets.voidSubnet(actor(req), params.id, body.reason);
    return { ok: true };
  }

  // --- Hồ sơ IP ---------------------------------------------------------------

  @Roles('sa', 'admin', 'member')
  @Get('addresses/:id')
  findAddress(@Param() params: IdParamDto) {
    return this.addresses.findOne(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Get('addresses/:id/history')
  addressHistory(@Param() params: IdParamDto) {
    return this.addresses.history(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Post('addresses')
  @Audited('ip.created', 'ip_address', { writtenByService: true })
  createAddress(@Body() body: IpBodyDto, @Req() req: AuthedRequest) {
    return this.addresses.create(actor(req), {
      subnetId: body.subnetId ?? '',
      address: body.address ?? '',
      deviceId: body.deviceId,
      usedBy: body.usedBy,
      assignedAt: body.assignedAt,
      note: body.note,
    });
  }

  @Roles('sa', 'admin', 'member')
  @Patch('addresses/:id')
  @Audited('ip.updated', 'ip_address', { writtenByService: true })
  updateAddress(
    @Param() params: IdParamDto,
    @Body() body: IpBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.addresses.update(actor(req), params.id, body);
  }

  /**
   * Chuyển trạng thái vòng đời (story 5.2) — đường DUY NHẤT đổi được `status`.
   *
   * Cả team IT làm được, giống như tạo hồ sơ IP: người phát hiện máy chết chính là người
   * trực, và bắt họ chờ Admin thì trạng thái sẽ không bao giờ được cập nhật.
   */
  @Roles('sa', 'admin', 'member')
  @Post('addresses/:id/transition')
  @Audited('ip.transitioned', 'ip_address', { writtenByService: true })
  transition(
    @Param() params: IdParamDto,
    @Body() body: TransitionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.addresses.transition(actor(req), params.id, body.to, {
      reason: body.reason,
      deviceId: body.deviceId,
      usedBy: body.usedBy,
    });
  }

  /**
   * Ẩn hồ sơ NHẬP NHẦM. IP hết dùng thì đi đường vòng đời (thu hồi, story 5.2) — ẩn một IP
   * đang dùng là làm mất luôn lịch sử mà AC 5.2 đòi giữ vĩnh viễn.
   */
  @Roles('sa', 'admin')
  @Delete('addresses/:id')
  @Audited('ip.voided', 'ip_address', { writtenByService: true })
  async voidAddress(
    @Param() params: IdParamDto,
    @Body() body: VoidDto,
    @Req() req: AuthedRequest,
  ) {
    await this.addresses.voidAddress(actor(req), params.id, body.reason);
    return { ok: true };
  }
}

function actor(req: AuthedRequest): string {
  return req.user!.email;
}
