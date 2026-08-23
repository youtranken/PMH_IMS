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
import { Transform, type TransformFnParams } from 'class-transformer';
import type { Response } from 'express';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { IpAddressService } from './ip-address.service';
import { IP_LIFECYCLE_STATUSES, type IpStatus } from './ip-lifecycle';
import { NAT_PROTOCOLS, NatRuleService, type NatProtocol } from './nat-rule.service';
import { parsePortRange } from './nat-rules';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { sendXlsx } from '../../common/excel/xlsx-http';
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

class NatBodyDto {
  @IsOptional() @IsUUID(undefined, { message: 'Mã thiết bị không hợp lệ.' }) deviceId?: string;

  @IsOptional()
  @IsIn([...NAT_PROTOCOLS], { message: 'Giao thức phải là TCP, UDP hoặc cả hai.' })
  protocol?: NatProtocol;

  /** Người dùng gõ "8080" hoặc "8000-8010" — một ô, không phải hai. */
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @Length(1, 11)
  externalPorts?: string;

  /**
   * `@Transform` cắt khoảng trắng TRƯỚC khi `@Length` chạy.
   *
   * Không có nó thì một IP dán từ Excel kèm dấu cách ("172.16.10.5 ") dài 16 ký tự và bị
   * `@Length(1, 15)` từ chối thẳng bằng một câu vô nghĩa với người dùng — họ nhìn ô thấy IP
   * đúng y như mình gõ mà hệ thống bảo sai (code review Epic 5, finding 5).
   */
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @Length(1, 15)
  internalIp?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) internalPort?: number;
  @IsOptional() @IsString() @Length(1, 160) usedBy?: string;
  @IsOptional() @IsString() @Length(1, 500) reason?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
}

/**
 * Bộ lọc sổ NAT.
 *
 * Có DTO chứ không nhận object trần: `deviceId`/`siteId` đi thẳng vào `eq(...)`, nên
 * `?deviceId=abc` xuống tới Postgres thành lỗi `22P02` và bung 500 thay vì 400
 * (code review Epic 5, finding 7).
 */
class NatQueryDto {
  @IsOptional() @ValidateIf((_o, v) => v !== '') @IsUUID(undefined, { message: 'Mã thiết bị không hợp lệ.' })
  deviceId?: string;

  @IsOptional() @ValidateIf((_o, v) => v !== '') @IsUUID(undefined, { message: 'Mã site không hợp lệ.' })
  siteId?: string;

  @IsOptional() @IsString() @Length(0, 120) search?: string;
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
    private readonly nat: NatRuleService,
    private readonly excel: ExcelExportService,
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

  /**
   * FR-028 / AC 7.2: xuất hồ sơ IP của một dải.
   *
   * Chỉ xuất những IP CÓ hồ sơ, không xuất các ô trống: ô trống không phải dữ liệu, và một
   * file 254 dòng mà 250 dòng rỗng thì người nhận phải tự lọc — đúng việc mình vừa bắt máy làm.
   */
  @Roles('sa', 'admin', 'member')
  // `objectType` là 'subnet': interceptor ghi `objectId = params.id`, mà id ở đây là id
  // của DẢI. Khai 'ip_address' thì dòng audit trỏ tới một uuid không tồn tại ở bảng đó.
  @Audited('ip.exported', 'subnet')
  @Get('subnets/:id/export.xlsx')
  async exportAddresses(@Param() params: IdParamDto, @Res() res: Response) {
    const subnet = await this.subnets.findOne(params.id);
    const rows = await this.addresses.listRecords(params.id);
    const buffer = await this.excel.build({
      sheetName: 'Dia chi IP',
      columns: [
        { header: 'Địa chỉ', width: 18, value: (r) => r.address },
        { header: 'Trạng thái', width: 16, value: (r) => IP_STATUS_LABEL[r.status] ?? r.status },
        { header: 'Thiết bị', width: 22, value: (r) => r.deviceCode ?? '' },
        { header: 'Người / bộ phận', width: 28, value: (r) => r.usedBy ?? '' },
        { header: 'Ngày cấp', width: 14, value: (r) => r.assignedAt ?? '' },
        { header: 'Người cấp', width: 24, value: (r) => r.assignedBy },
        { header: 'Ghi chú', width: 36, value: (r) => r.note ?? '' },
      ],
      rows,
    });
    sendXlsx(res, buffer, `ip-${subnet.cidr.replace('/', '-')}.xlsx`);
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
  // --- Sổ NAT (story 5.3, FR-017) ---------------------------------------------

  /**
   * Cả team IT ĐỌC được: "port nào mở" là câu hỏi lúc xử lý sự cố, không phải câu hỏi
   * hành chính. Ghi thì cũng cả team — người mở port chính là người biết vì sao mở.
   */
  @Roles('sa', 'admin', 'member')
  @Get('nat')
  listNat(@Query() query: NatQueryDto) {
    return this.nat.list(query);
  }

  /**
   * Xuất Excel để nộp cho auditor (AC 5.3). Cố ý KHÔNG có ở két sắt nhưng CÓ ở đây: sổ NAT
   * là thứ người ta phải đem đi trình, còn mật khẩu thì không (FR-026).
   */
  @Roles('sa', 'admin', 'member')
  @Audited('nat.exported', 'nat_rule')
  @Get('nat/export.xlsx')
  async exportNat(@Query() query: NatQueryDto, @Res() res: Response) {
    const rows = await this.nat.list(query);
    const buffer = await this.excel.build({
      sheetName: 'So NAT',
      columns: [
        { header: 'Router', width: 22, value: (r) => r.deviceCode ?? '' },
        { header: 'Site', width: 12, value: (r) => r.siteCode ?? '' },
        { header: 'Giao thức', width: 12, value: (r) => r.protocol.toUpperCase() },
        { header: 'Port ngoài', width: 14, value: (r) => r.externalPorts },
        { header: 'IP trong', width: 16, value: (r) => r.internalIp },
        { header: 'Port trong', width: 12, value: (r) => r.internalPort },
        { header: 'Máy trong', width: 22, value: (r) => r.internalOwner ?? '' },
        { header: 'Mở cho ai', width: 24, value: (r) => r.usedBy },
        { header: 'Lý do', width: 40, value: (r) => r.reason },
        { header: 'Đang bật', width: 10, value: (r) => (r.enabled ? 'Có' : 'Không') },
      ],
      rows,
    });
    sendXlsx(res, buffer, 'so-nat.xlsx');
  }

  @Roles('sa', 'admin', 'member')
  @Get('nat/:id')
  findNat(@Param() params: IdParamDto) {
    return this.nat.findOne(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Post('nat')
  @Audited('nat.created', 'nat_rule', { writtenByService: true })
  createNat(@Body() body: NatBodyDto, @Req() req: AuthedRequest) {
    const ports = requirePorts(body.externalPorts);
    return this.nat.create(actor(req), {
      deviceId: body.deviceId ?? '',
      protocol: body.protocol ?? 'tcp',
      externalFrom: ports.from,
      externalTo: ports.to,
      internalIp: body.internalIp ?? '',
      internalPort: body.internalPort ?? 0,
      usedBy: body.usedBy ?? '',
      reason: body.reason ?? '',
      enabled: body.enabled,
      note: body.note,
    });
  }

  @Roles('sa', 'admin', 'member')
  @Patch('nat/:id')
  @Audited('nat.updated', 'nat_rule', { writtenByService: true })
  updateNat(@Param() params: IdParamDto, @Body() body: NatBodyDto, @Req() req: AuthedRequest) {
    const ports = body.externalPorts === undefined ? null : requirePorts(body.externalPorts);
    return this.nat.update(actor(req), params.id, {
      deviceId: body.deviceId,
      protocol: body.protocol,
      externalFrom: ports?.from,
      externalTo: ports?.to,
      internalIp: body.internalIp,
      internalPort: body.internalPort,
      usedBy: body.usedBy,
      reason: body.reason,
      enabled: body.enabled,
      note: body.note,
    });
  }

  /** Gỡ rule = ẩn kèm lý do: "port 8080 đóng ngày nào, ai đóng, vì sao" sẽ có người hỏi. */
  @Roles('sa', 'admin')
  @Delete('nat/:id')
  @Audited('nat.voided', 'nat_rule', { writtenByService: true })
  async voidNat(@Param() params: IdParamDto, @Body() body: VoidDto, @Req() req: AuthedRequest) {
    await this.nat.voidRule(actor(req), params.id, body.reason);
    return { ok: true };
  }
}

/**
 * Cắt khoảng trắng ở hai đầu TRƯỚC khi các luật `@Length`/`@IsString` chạy.
 *
 * Tách thành hàm có kiểu rõ ràng thay vì lambda inline: `value` của class-transformer là
 * `any`, và lambda inline làm eslint đỏ ở mỗi chỗ dùng.
 */
function trimText({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function actor(req: AuthedRequest): string {
  return req.user!.email;
}

/**
 * Đổi ô "8080" / "8000-8010" thành cặp số. Lỗi nói ĐÚNG chỗ sai (viết ngược đầu ≠ sai định
 * dạng) — người gõ biết mình muốn gì, chỉ cần được chỉ đúng chỗ.
 */
function requirePorts(value: string | undefined): { from: number; to: number } {
  const parsed = parsePortRange(value ?? '');
  if (parsed.ok) return { from: parsed.from, to: parsed.to };
  throw new BadRequestException({
    code: 'NAT_PORT_INVALID',
    message: PORT_MESSAGE[parsed.reason],
  });
}

const PORT_MESSAGE: Record<string, string> = {
  format: 'Port ngoài viết dạng "8080" hoặc "8000-8010".',
  range: 'Port phải từ 1 đến 65535.',
  reversed: 'Khoảng port viết ngược — số đầu phải nhỏ hơn số cuối (vd 8000-8010).',
};

const IP_STATUS_LABEL: Record<string, string> = {
  free: 'Trống',
  assigned: 'Đang cấp',
  suspect_dead: 'Nghi chết',
  reclaimed: 'Đã thu hồi',
};
