import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
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
  Max,
  Min,
  Validate,
  ValidateIf,
} from 'class-validator';
import { NoSecretText } from '../../common/no-secret-text';
import { RealDateOrEmpty } from '../../common/real-date';
import { BadRequestException } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { IP_SEARCH_MAX, IpAddressService } from './ip-address.service';
import { IP_LIFECYCLE_STATUSES, type IpStatus } from './ip-lifecycle';
import { NAT_PROTOCOLS, NatRuleService, type NatProtocol } from './nat-rule.service';
import { parsePortRange } from './nat-rules';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { sendXlsx } from '../../common/excel/xlsx-http';
import { SubnetService } from './subnet.service';
import { NoStepUp } from '../auth/step-up.decorator';
import { DevicesApiService } from '../devices/devices.api';
import { UsersApiService } from '../users/users.api';
import { SystemConfigService } from '../config-sys/system-config.service';
import { withActorNames } from '../../common/history';
import { sensitivePortsOf } from './nat-sensitive';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class DeviceIdsQueryDto {
  /** Mã máy ngăn bởi dấu phẩy — một trang danh sách (tối đa 100 dòng) vừa trong 4000 ký tự. */
  @IsOptional() @IsString() @Length(0, 4000) deviceIds?: string;
}

export class SubnetBodyDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsString() @Length(1, 43) cidr?: string;
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() siteId?: string;

  /**
   * 1–4094: dải hợp lệ của 802.1Q. 0 và 4095 là hai giá trị dành riêng của chuẩn.
   * `null` = xóa số VLAN đang có (ô để trống là một ý định rõ ràng, không phải "đừng đụng").
   */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsInt()
  @Min(1, { message: 'VLAN phải từ 1 đến 4094.' })
  @Max(4094, { message: 'VLAN phải từ 1 đến 4094.' })
  vlan?: number | null;

  /**
   * Gateway của dải. Chuỗi rỗng = xóa gateway đang có — ô để trống là ý định rõ ràng
   * ("dải point-to-point này không có gateway"), không phải "đừng đụng tới".
   *
   * Chỉ kiểm ĐỘ DÀI ở đây; "có nằm trong dải không" là luật nghiệp vụ, thuộc về service —
   * và còn một CHECK ở tầng DB nữa cho mọi đường vào không đi qua HTTP.
   */
  @IsOptional() @IsString() @Length(0, 15) gateway?: string;

  @IsOptional() @IsString() @Length(0, 500) @NoSecretText() description?: string;
}

export class IpBodyDto {
  @IsOptional() @IsUUID(undefined, { message: 'Mã dải không hợp lệ.' }) subnetId?: string;
  @IsOptional() @IsString() @Length(1, 15) address?: string;
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() deviceId?: string;
  @IsOptional() @IsString() @Length(0, 160) usedBy?: string;

  @IsOptional() @Validate(RealDateOrEmpty, { message: 'Ngày cấp phải là ngày có thật, dạng YYYY-MM-DD.' })
  assignedAt?: string;

  @IsOptional() @IsString() @Length(0, 2000) @NoSecretText() note?: string;

  /** Chỉ khi tạo: lý do cấp, ghi vào dòng lịch sử đầu tiên. */
  @IsOptional() @IsString() @Length(0, 500) @NoSecretText() reason?: string;
}

export class TransitionDto {
  @IsIn([...IP_LIFECYCLE_STATUSES], { message: 'Trạng thái đích không hợp lệ.' })
  to!: IpStatus;

  @IsOptional() @IsString() @Length(0, 500) @NoSecretText() reason?: string;

  // Cấp / cấp lại thường đi kèm chủ mới — nhận luôn để lịch sử ghi thành MỘT dòng.
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() deviceId?: string;
  @IsOptional() @IsString() @Length(0, 160) usedBy?: string;

  // Hộp "Cấp IP" dùng chung cho ô trống và hồ sơ Trống gửi cùng một bộ trường.
  @IsOptional() @Validate(RealDateOrEmpty, { message: 'Ngày cấp phải là ngày có thật, dạng YYYY-MM-DD.' })
  assignedAt?: string;
  @IsOptional() @IsString() @Length(0, 2000) @NoSecretText() note?: string;
}

/**
 * "Đổi IP" của một thiết bị (Q-20) — địa chỉ mới; máy lấy từ hồ sơ IP đang giữ, không nhận từ
 * body, để không ai dùng cửa này chuyển IP sang một máy khác.
 */
export class ChangeIpDto {
  @IsUUID(undefined, { message: 'Mã dải không hợp lệ.' }) subnetId!: string;
  @IsString() @Length(1, 15) address!: string;
  @IsOptional() @Validate(RealDateOrEmpty, { message: 'Ngày cấp phải là ngày có thật, dạng YYYY-MM-DD.' })
  assignedAt?: string;
  @IsOptional() @IsString() @Length(0, 2000) @NoSecretText() note?: string;
  @IsOptional() @IsString() @Length(0, 500) @NoSecretText() reason?: string;
}

/** Xóa hồ sơ IP nhập nhầm — LUÔN phải có lý do, vì vết duy nhất còn lại nằm trong nhật ký. */
export class VoidDto {
  @IsString() @Length(3, 500) @NoSecretText() reason!: string;
}

export class NatBodyDto {
  /*
   * `@ValidateIf` cho chuỗi RỖNG đi qua cửa DTO — giống hệt `IpBodyDto` và `TransitionDto`
   * ngay trên, và vì đúng một lý do.
   *
   * Màn Sổ NAT khởi tạo ô router bằng `useState('')` rồi gửi nguyên biến đó, nên "chưa chọn"
   * tới đây là `deviceId: ''`, không phải khoá vắng mặt. `@IsOptional()` chỉ bỏ qua
   * `undefined`/`null`, nên thiếu `@ValidateIf` thì `''` bị chặn ngay tại đây với câu "Mã
   * thiết bị không hợp lệ." — và `requireDeviceId()` bên dưới, cùng câu tiếng Việt nói rõ
   * người dùng quên gì, không bao giờ chạy tới trên đường giao diện thật đi.
   *
   * Nới ở đây KHÔNG làm mất lớp chặn: giá trị rỗng rơi xuống `requireDeviceId()` ở `POST`
   * (400 `FIELD_REQUIRED`), còn `PATCH` vẫn được phép không gửi khoá này. Chuỗi rác không
   * phải uuid vẫn bị `@IsUUID` chặn như cũ.
   */
  @IsOptional()
  @ValidateIf((_o, value) => value !== '')
  @IsUUID(undefined, { message: 'Mã thiết bị không hợp lệ.' })
  deviceId?: string;

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
   * đúng y như mình gõ mà hệ thống bảo sai.
   */
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @Length(1, 15)
  internalIp?: string;
  @IsOptional() @Min(1) @Max(65535) @IsInt() internalPort?: number;
  @IsOptional() @IsString() @Length(1, 160) usedBy?: string;
  @IsOptional() @IsString() @Length(1, 500) @NoSecretText() reason?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @Length(0, 2000) @NoSecretText() note?: string;
}

/**
 * Bộ lọc sổ NAT.
 *
 * Có DTO chứ không nhận object trần: `deviceId`/`siteId` đi thẳng vào `eq(...)`, nên
 * `?deviceId=abc` xuống tới Postgres thành lỗi `22P02` và bung 500 thay vì 400.
 */
class NatQueryDto {
  @IsOptional() @ValidateIf((_o, v) => v !== '') @IsUUID(undefined, { message: 'Mã thiết bị không hợp lệ.' })
  deviceId?: string;

  @IsOptional() @ValidateIf((_o, v) => v !== '') @IsUUID(undefined, { message: 'Mã site không hợp lệ.' })
  siteId?: string;

  @IsOptional() @IsString() @Length(0, 120) search?: string;

  /** `'true'` = có cả rule đã gỡ (để tra lại "port này đóng ngày nào, ai đóng, vì sao"). */
  @IsOptional() @IsIn(['true', 'false']) includeVoided?: string;
}

/** Bộ lọc của sổ NAT gửi xuống service — cờ chuỗi của query đổi thành boolean ở đúng một chỗ. */
function natFilters(query: NatQueryDto) {
  return {
    deviceId: query.deviceId,
    siteId: query.siteId,
    search: query.search,
    includeVoided: query.includeVoided === 'true',
  };
}

class IpSearchQueryDto {
  @IsOptional() @IsString() @Length(0, 120) search?: string;

  @IsOptional()
  @Transform(({ value }: TransformFnParams) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(IP_SEARCH_MAX)
  limit?: number;
}

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã không hợp lệ.' })
  id!: string;
}

/**
 * Dải mạng và hồ sơ IP (FR-018/FR-019/FR-020).
 *
 * Quyền: khai/sửa/ẩn DẢI là việc của Admin — dải khai sai kéo theo mọi IP bên trong sai.
 * Còn hồ sơ IP thì cả team IT làm được: người cắm máy chính là người biết IP nào vừa cấp,
 * bắt họ chờ Admin duyệt thì cuốn sổ sẽ lại quay về file Excel trên máy ai đó.
 */
@NoStepUp()
@Controller('api/v1/ipam')
export class IpamController {
  constructor(
    private readonly subnets: SubnetService,
    private readonly addresses: IpAddressService,
    private readonly nat: NatRuleService,
    private readonly excel: ExcelExportService,
    private readonly devices: DevicesApiService,
    private readonly users: UsersApiService,
    private readonly config: SystemConfigService,
  ) {}

  /**
   * Ngưỡng hiển thị của màn IP, đọc từ `system_config` (AD-11).
   *
   * Thẻ dải tô "sắp đầy" theo CÙNG con số bảng điều khiển dùng để nhắc dải sắp đầy — hai chỗ
   * nói khác nhau về một dải là người đọc không biết tin chỗ nào.
   *
   * `subnetMinPrefix`, `natWidePortRange`: form báo "quá rộng" ngay khi gõ theo CÙNG ngưỡng server
   * sẽ xét, không giữ bản sao con số ở web.
   */
  @Roles('sa', 'admin', 'member')
  @Get('settings')
  async settings() {
    const [subnetFullPercent, sensitive, subnetMinPrefix, natWidePortRange] = await Promise.all([
      this.config.getNumber('dashboardSubnetFullPercent'),
      this.config.getString('natSensitivePorts'),
      this.config.getNumber('ipamSubnetMinPrefix'),
      this.config.getNumber('natWidePortRange'),
    ]);
    return {
      subnetFullPercent,
      natSensitivePorts: sensitivePortsOf(sensitive),
      subnetMinPrefix,
      natWidePortRange,
    };
  }

  // --- Dải mạng ---------------------------------------------------------------

  /**
   * `?includeVoided=true` — CHỈ màn dải mạng dùng cờ này.
   *
   * Mặc định vẫn là "chỉ dải đang dùng", nên mọi thứ đọc dải qua `IpamApiService` không đổi
   * hành vi: bảng điều khiển "Dải mạng sắp đầy" không được lôi một dải đã tắt lên nhắc sếp.
   */
  @Roles('sa', 'admin', 'member')
  @Get('subnets')
  listSubnets(@Query('includeVoided') includeVoided?: string) {
    return this.subnets.list({ includeVoided: includeVoided === 'true' });
  }

  @Roles('sa', 'admin', 'member')
  @Get('subnets/:id')
  findSubnet(@Param() params: IdParamDto) {
    return this.subnets.findOne(params.id);
  }

  /**
   * Toàn bộ dải: IP đã có hồ sơ + ô còn trống (AC 5.1).
   *
   * `?includeVoided=true` hiện thêm hồ sơ ĐÃ ẨN. Mặc định tắt vì ẩn một hồ sơ nhập nhầm phải
   * trả ô đó về "trống" — đó là toàn bộ ý nghĩa của việc ẩn. Nhưng phải có đường BẬT nó lên:
   * không có thì hồ sơ ẩn nhầm biến khỏi mọi màn và cửa `restore` mới thêm không ai tới được.
   */
  @Roles('sa', 'admin', 'member')
  @Get('subnets/:id/addresses')
  listSlots(@Param() params: IdParamDto, @Query() query: { includeVoided?: string }) {
    return this.addresses.listBySubnet(params.id, query.includeVoided === 'true');
  }

  /**
   * IP đã cấp cho MỘT thiết bị.
   *
   * Form NAT hỏi cái này: chọn máy đích xong thì ô "IP trong" chỉ còn đúng những IP của
   * chính máy đó — hết cảnh gõ tay một địa chỉ không thuộc máy nào (thứ mà `validateNatRule`
   * đang phải chặn ở tầng sau).
   */
  /**
   * IP đang giữ của nhiều máy một lượt — cột IP của danh sách thiết bị (một trang, không N+1).
   * Khai TRƯỚC `devices/:deviceId/addresses`: hai route khác số khúc nên không nuốt nhau, nhưng
   * đặt cạnh nhau để ai thêm `devices/:x` sau này thấy ngay. Mã máy sai dạng bị bỏ lặng lẽ —
   * cột IP là thông tin phụ, không đáng làm hỏng cả danh sách.
   */
  @Roles('sa', 'admin', 'member')
  @Get('devices/addresses')
  async heldAddresses(@Query() query: DeviceIdsQueryDto) {
    const ids = (query.deviceIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => UUID_RE.test(id));
    return Object.fromEntries(await this.addresses.heldAddressesOf(ids));
  }

  @Roles('sa', 'admin', 'member')
  @Get('devices/:deviceId/addresses')
  listForDevice(@Param('deviceId', new ParseUUIDPipe()) deviceId: string) {
    return this.addresses.listForDevice(deviceId);
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
    /*
     * Dải đã vô hiệu hóa thì xuất luôn cả hồ sơ đã tắt theo nó — CÙNG luật với bảng trên màn
     * hình (`listBySubnet`). Không đồng bộ chỗ này thì màn hình hiện 6 dòng còn file Excel ra
     * 0 dòng, và người ta sẽ tin cái file.
     */
    const rows = await this.addresses.listRecords(params.id, {
      includeVoided: subnet.voidedAt !== null,
    });
    const buffer = await this.excel.build({
      sheetName: 'Địa chỉ IP',
      columns: [
        { header: 'Địa chỉ', width: 18, value: (r) => r.address },
        { header: 'Trạng thái', width: 16, value: (r) => IP_STATUS_LABEL[r.status] ?? r.status },
        { header: 'Thiết bị', width: 22, value: (r) => r.deviceCode ?? '' },
        { header: 'Người / phòng ban', width: 28, value: (r) => r.usedBy ?? '' },
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
    /**
     * Liệt kê tay từng trường ở đây là chỗ ĐÃ ĐÁNH RƠI dữ liệu hai lần trong dự án này
     * (`licenseModel` ở `SoftwareService.prepare`, rồi `vlan` ở đúng chỗ này): thêm cột mới,
     * quên thêm một dòng, và giá trị biến mất trên đường xuống service mà không lỗi nào nổ.
     * Thêm trường vào `SubnetBodyDto` thì PHẢI thêm cả ở đây.
     */
    return this.subnets.create(actor(req), {
      name: body.name ?? '',
      cidr: body.cidr ?? '',
      siteId: body.siteId,
      vlan: body.vlan,
      gateway: body.gateway,
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

  /**
   * Vô hiệu hóa kèm lý do — dùng cho dải ĐÃ TỪNG có hồ sơ IP. Bản ghi ở lại, tra cứu được.
   *
   * Là `PATCH :id/void` chứ không phải `DELETE`, để `DELETE` mang đúng nghĩa của nó: xóa hẳn.
   * Hai việc khác nhau thì hai cửa khác nhau — một `DELETE` mà thực ra là ẩn là cái bẫy cho
   * bất cứ ai đọc route mà không đọc service.
   */
  @Roles('sa', 'admin')
  @Patch('subnets/:id/void')
  @Audited('subnet.voided', 'subnet', { writtenByService: true })
  async voidSubnet(
    @Param() params: IdParamDto,
    @Body() body: VoidDto,
    @Req() req: AuthedRequest,
  ) {
    await this.subnets.voidSubnet(actor(req), params.id, body.reason);
    return { ok: true };
  }

  /**
   * BẬT LẠI một dải đã vô hiệu hóa.
   *
   * Đối xứng với `:id/void`. Không có nó thì vô hiệu hóa là một cánh cửa một chiều, và ai lỡ
   * tay bấm nhầm chỉ còn cách khai lại dải rồi gõ tay từng hồ sơ IP — với một /24 dùng nửa
   * dải thì đó là hơn trăm lượt nhập cho một cú bấm nhầm.
   *
   * KHÔNG hỏi lý do: bật lại là việc khôi phục, nó không lấy đi thứ gì. Bắt gõ lý do cho một
   * thao tác vô hại chỉ dạy người dùng thói quen gõ bừa cho qua ô bắt buộc — rồi tới ô lý do
   * THẬT SỰ quan trọng (vô hiệu hóa) họ cũng gõ bừa nốt.
   */
  @Roles('sa', 'admin')
  @Patch('subnets/:id/restore')
  @Audited('subnet.restored', 'subnet', { writtenByService: true })
  async restoreSubnet(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    await this.subnets.restore(actor(req), params.id);
    return { ok: true };
  }

  /**
   * XÓA HẲN — chỉ dải CHƯA TỪNG có hồ sơ IP nào (quyết định của chủ dự án).
   *
   * Khai nhầm một dải rồi phải sống chung với nó mãi là phiền vô lý: dải chưa dùng thì chưa
   * mang thông tin gì, xóa đi khai lại. Dải đã từng dùng thì service từ chối kèm số hồ sơ IP
   * đang giữ lịch sử, và chỉ sang đường vô hiệu hóa.
   */
  @Roles('sa', 'admin')
  @Delete('subnets/:id')
  @Audited('subnet.deleted', 'subnet', { writtenByService: true })
  async deleteSubnet(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    await this.subnets.remove(actor(req), params.id);
    return { ok: true };
  }

  // --- Hồ sơ IP ---------------------------------------------------------------

  /**
   * Tra hồ sơ IP xuyên mọi dải — theo địa chỉ, mã/tên máy, hoặc người/bộ phận.
   * Cả team IT đọc được, cùng mức với bảng IP của từng dải.
   */
  @Roles('sa', 'admin', 'member')
  @Get('addresses')
  searchAddresses(@Query() query: IpSearchQueryDto) {
    return this.addresses.search(query.search ?? '', query.limit ?? 20);
  }

  @Roles('sa', 'admin', 'member')
  @Get('addresses/:id')
  findAddress(@Param() params: IdParamDto) {
    return this.addresses.findOne(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Get('addresses/:id/history')
  async addressHistory(@Param() params: IdParamDto) {
    const rows = await this.addresses.history(params.id);
    /*
     * "IP này từng của MÁY NÀO" (AC 5.2) — dòng lịch sử chỉ giữ `deviceId`, nên tra ra mã máy
     * một lượt cho cả trang. Máy đã thanh lý vẫn tra được mã (`getByIds` không lọc).
     */
    const ids = rows.flatMap((row) => {
      const changes = (row.changes ?? {}) as Record<string, unknown>;
      return [changes.deviceId, changes.previousDeviceId].filter(
        (value): value is string => typeof value === 'string' && value !== '',
      );
    });
    const devices = await this.devices.getByIds(ids);
    const codeOf = (value: unknown) =>
      typeof value === 'string' ? (devices.get(value)?.code ?? null) : null;
    const withCodes = rows.map((row) => {
      const changes = (row.changes ?? {}) as Record<string, unknown>;
      return {
        ...row,
        deviceCode: codeOf(changes.deviceId),
        previousDeviceCode: codeOf(changes.previousDeviceId),
      };
    });
    return withActorNames(withCodes, (emails) => this.users.namesByEmails(emails));
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
      reason: body.reason,
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
   * Chuyển trạng thái vòng đời (FR-019) — đường DUY NHẤT đổi được `status`.
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
      assignedAt: body.assignedAt,
      note: body.note,
    });
  }

  /**
   * ĐỔI IP (Q-20): thu hồi IP máy đang giữ và cấp địa chỉ mới trong MỘT transaction. Cùng mức
   * quyền với Cấp IP / Thu hồi — đây chỉ là hai việc đó gộp lại cho khỏi hở giữa chừng.
   */
  @Roles('sa', 'admin', 'member')
  @Post('addresses/:id/change')
  @Audited('ip.changed', 'ip_address', { writtenByService: true })
  changeAddress(
    @Param() params: IdParamDto,
    @Body() body: ChangeIpDto,
    @Req() req: AuthedRequest,
  ) {
    return this.addresses.changeAddress(actor(req), params.id, {
      subnetId: body.subnetId,
      address: body.address,
      assignedAt: body.assignedAt,
      note: body.note,
      reason: body.reason,
    });
  }

  /**
   * Xóa hồ sơ NHẬP NHẦM để nhập lại (Q-15). IP hết dùng thì đi đường vòng đời (thu hồi) —
   * xóa một IP đang dùng là làm mất khỏi màn lịch sử mà AC 5.2 đòi giữ.
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

  /**
   * KHÔI PHỤC hồ sơ đã xóa — chỉ SA, không có nút trên giao diện (Q-15: xóa là để nhập lại).
   * Hẹp hơn quyền Xóa để việc đảo ngược một lượt xóa luôn qua người giữ quyền cao nhất và
   * để vết `ip.restored` trong nhật ký.
   */
  @Roles('sa')
  @Post('addresses/:id/restore')
  @Audited('ip.restored', 'ip_address', { writtenByService: true })
  restoreAddress(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    return this.addresses.restore(actor(req), params.id);
  }
  // --- Sổ NAT (FR-017) --------------------------------------------------------

  /**
   * Cả team IT ĐỌC được: "port nào mở" là câu hỏi lúc xử lý sự cố, không phải câu hỏi
   * hành chính. Ghi thì cũng cả team — người mở port chính là người biết vì sao mở.
   */
  @Roles('sa', 'admin', 'member')
  @Get('nat')
  listNat(@Query() query: NatQueryDto) {
    return this.nat.list(natFilters(query));
  }

  /**
   * Xuất Excel để nộp cho auditor (AC 5.3). Cố ý KHÔNG có ở két sắt nhưng CÓ ở đây: sổ NAT
   * là thứ người ta phải đem đi trình, còn mật khẩu thì không (FR-026).
   */
  @Roles('sa', 'admin', 'member')
  @Audited('nat.exported', 'nat_rule')
  @Get('nat/export.xlsx')
  async exportNat(@Query() query: NatQueryDto, @Res() res: Response) {
    const rows = await this.nat.list(natFilters(query));
    const buffer = await this.excel.build({
      sheetName: 'Sổ NAT',
      columns: [
        { header: 'Router', width: 22, value: (r) => r.deviceCode ?? '' },
        { header: 'Site', width: 12, value: (r) => r.siteCode ?? '' },
        { header: 'Giao thức', width: 12, value: (r) => r.protocol.toUpperCase() },
        { header: 'Cổng ngoài', width: 14, value: (r) => r.externalPorts },
        { header: 'IP trong', width: 16, value: (r) => r.internalIp },
        { header: 'Cổng trong', width: 12, value: (r) => r.internalPort },
        { header: 'Máy trong', width: 22, value: (r) => r.internalOwner ?? '' },
        { header: 'Mở cho ai', width: 24, value: (r) => r.usedBy },
        { header: 'Lý do', width: 40, value: (r) => r.reason },
        { header: 'Đang dùng', width: 10, value: (r) => (r.enabled ? 'Có' : 'Không') },
        // Ba cột chỉ có giá trị khi xuất kèm rule đã gỡ; để trống là rule còn trong sổ.
        { header: 'Gỡ lúc', width: 18, value: (r) => r.voidedAt },
        { header: 'Người gỡ', width: 24, value: (r) => r.voidedBy ?? '' },
        { header: 'Lý do gỡ', width: 36, value: (r) => r.voidReason ?? '' },
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

  /**
   * Lịch sử của MỘT rule — kể cả rule đã gỡ.
   *
   * Đọc thì mọi vai đã đăng nhập, cùng mức với chính sổ NAT: "port này từng mở cho ai" là câu
   * người trực cần trả lời lúc 2 giờ sáng, không phải câu chỉ quản trị mới được biết.
   */
  @Roles('sa', 'admin', 'member')
  @Get('nat/:id/history')
  async natHistory(@Param() params: IdParamDto) {
    return withActorNames(await this.nat.history(params.id), (emails) =>
      this.users.namesByEmails(emails),
    );
  }

  @Roles('sa', 'admin', 'member')
  @Post('nat')
  @Audited('nat.created', 'nat_rule', { writtenByService: true })
  createNat(@Body() body: NatBodyDto, @Req() req: AuthedRequest) {
    const ports = requirePorts(body.externalPorts);
    return this.nat.create(actor(req), {
      deviceId: requireDeviceId(body.deviceId),
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
 * Rule NAT phải có router — và thiếu nó phải là 400, không phải 500.
 *
 * `NatBodyDto` để `deviceId` là tuỳ chọn vì cùng một DTO phục vụ cả `POST` lẫn `PATCH`, mà
 * `PATCH` thì được phép không gửi. Lấp chỗ trống bằng `body.deviceId ?? ''` là để chuỗi
 * rỗng đi thẳng xuống `eq(deviceTable.id, '')`: Postgres từ chối ép '' sang uuid
 * (`22P02`), lỗi bung ra ngoài thành 500 kèm một câu tiếng Anh về kiểu dữ liệu. Người trực
 * quên chọn router thì đáng nhận một câu tiếng Việt nói họ quên gì, không phải một sự cố máy
 * chủ.
 */
function requireDeviceId(value: string | undefined): string {
  const id = value?.trim();
  if (id) return id;
  throw new BadRequestException({
    code: 'FIELD_REQUIRED',
    message: 'Chọn thiết bị (router) cho luật NAT này.',
  });
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
  format: 'Cổng ngoài viết dạng "8080" hoặc "8000-8010".',
  range: 'Cổng phải từ 1 đến 65535.',
  reversed: 'Khoảng cổng viết ngược — số đầu phải nhỏ hơn số cuối (vd 8000-8010).',
};

const IP_STATUS_LABEL: Record<string, string> = {
  free: 'Trống',
  assigned: 'Đang dùng',
};
