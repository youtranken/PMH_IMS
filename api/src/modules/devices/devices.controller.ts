import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  Validate,
  ValidateIf,
} from 'class-validator';
import { NoSecretText } from '../../common/no-secret-text';
import { RealDateOrEmpty } from '../../common/real-date';
import { parsePageQuery } from '../../common/pagination';
import { parseSortQuery } from '../../common/sorting';
import { splitUuidList } from '../../common/query-uuid';
import {
  requireXlsx,
  sendXlsx,
  XLSX_UPLOAD_LIMIT,
} from '../../common/excel/xlsx-http';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { DevicePanelRegistry } from '../../common/device-panels.registry';
import { DeviceTimelineRegistry } from '../../common/device-timeline.registry';
import { HISTORY_PAGE_LIMIT, withActorNames } from '../../common/history';
import { UsersApiService } from '../users/users.api';
import { DeviceImportService } from './device-import.service';
import { DeviceExportQueryDto, DeviceListQueryDto } from './device-query.dto';
import { SystemConfigService } from '../config-sys/system-config.service';
import { DevicePortsService } from './device-ports.service';
import {
  DEVICE_SORT_DEFAULT,
  DEVICE_SORT_KEYS,
  DevicesService,
} from './devices.service';
import { DEVICE_STATUSES, deviceStatusQuery, type DeviceStatus } from './devices.types';
import { NoStepUp } from '../auth/step-up.decorator';
import { Feature, FeatureFree } from '../auth/feature.decorator';

export class DeviceBodyDto {
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

  @IsOptional() @Validate(RealDateOrEmpty, { message: 'Ngày mua phải là ngày có thật, dạng YYYY-MM-DD.' })
  purchaseDate?: string;

  @IsOptional() @Validate(RealDateOrEmpty, { message: 'Ngày bắt đầu bảo hành phải là ngày có thật, dạng YYYY-MM-DD.' })
  warrantyStart?: string;

  @IsOptional() @Validate(RealDateOrEmpty, { message: 'Ngày hết bảo hành phải là ngày có thật, dạng YYYY-MM-DD.' })
  warrantyEnd?: string;

  @IsOptional()
  @IsIn([...DEVICE_STATUSES], { message: 'Trạng thái thiết bị không hợp lệ.' })
  status?: DeviceStatus;

  @IsOptional() @IsString() @Length(0, 2000) @NoSecretText() note?: string;

  // Vị trí trong tủ: `null` = bỏ U. Luật cặp / vượt tủ / chồng U ở service (`rack-units.ts`).
  @IsOptional() @ValidateIf((_o, value) => value !== null) @IsInt({ message: 'U bắt đầu phải là số nguyên.' }) @Min(1) @Max(60) rackUStart?: number | null;
  @IsOptional() @ValidateIf((_o, value) => value !== null) @IsInt({ message: 'Số U phải là số nguyên.' }) @Min(1) @Max(60) rackUSize?: number | null;
  /** Model danh mục (Q-26); `null` hay chuỗi rỗng = bỏ gán, máy về "chưa có Model". */
  @IsOptional() @ValidateIf((_o, value) => value !== null && value !== '') @IsUUID(undefined, { message: 'Model không hợp lệ.' }) deviceModelId?: string | null;
  /** Truy cập quản trị: từng dòng do `normalizeAccessPoints` kiểm (kiểu, địa chỉ, cổng). */
  @IsOptional() @IsArray({ message: 'Truy cập quản trị phải là danh sách.' }) accessPoints?: unknown[];
}

/** Trạng thái đổi hàng loạt được — KHÔNG có Thanh lý: thanh lý đi luồng riêng (tài sản đang giữ, biên bản). */
const BULK_STATUSES = DEVICE_STATUSES.filter((status) => status !== 'retired');
const BULK_MAX = 200;

class BulkStatusDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(BULK_MAX, { message: `Một lượt tối đa ${BULK_MAX} thiết bị.` })
  @IsUUID(undefined, { each: true, message: 'Mã thiết bị không hợp lệ.' })
  ids!: string[];

  @IsIn(BULK_STATUSES, { message: 'Đổi hàng loạt chỉ sang Đang dùng / Dự phòng / Hỏng — thanh lý làm từng máy.' })
  status!: DeviceStatus;
}

class BulkUpdateDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(BULK_MAX, { message: `Một lượt tối đa ${BULK_MAX} thiết bị.` })
  @IsUUID(undefined, { each: true, message: 'Mã thiết bị không hợp lệ.' })
  ids!: string[];

  @IsOptional() @IsString() @Length(0, 120) assignedTo?: string;
  @IsOptional() @IsString() @Length(0, 120) department?: string;
}

class StatusDto {
  @IsIn([...DEVICE_STATUSES], { message: 'Trạng thái thiết bị không hợp lệ.' })
  status!: DeviceStatus;

  /**
   * Lựa chọn "Gỡ hết rồi thanh lý" trên hộp thanh lý — chỉ có nghĩa khi `status = 'retired'`.
   *
   * Mặc định `false` là có chủ ý: dọn tự động thu hồi IP, gỡ rule NAT và trả ghế license trong
   * một cú bấm, nên nó phải là lựa chọn NGƯỜI DÙNG NÓI RA, không phải mặc định êm ái.
   */
  @IsOptional() @IsBoolean() cleanup?: boolean;
}

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã thiết bị không hợp lệ.' })
  id!: string;
}


/** Trần một lượt Nối hàng loạt — một switch lớn nhất cũng chỉ vài chục cổng. */
const BULK_LINK_MAX = 96;

export class PortBodyDto {
  @IsOptional() @IsString() @Length(1, 60) portLabel?: string;

  // Chuỗi rỗng = gỡ liên kết tới thiết bị trong kho (đầu kia thành mô tả tự do).
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() connectedDeviceId?: string;

  // Đầu kia không có trong kho thì người dùng gõ mô tả tự do — ô chữ dạng rõ như ghi chú.
  @IsOptional() @IsString() @Length(0, 200) @NoSecretText('Đầu kia') connectedLabel?: string;
  @IsOptional() @IsString() @Length(0, 60) connectedPort?: string;
  @IsOptional() @IsString() @Length(0, 120) usedBy?: string;

  // VLAN của cổng: text, vì "trunk" là giá trị có thật và hay gặp nhất trên uplink.
  // Dạng hợp lệ (1–4094 | trunk) kiểm ở `portVlanOf`, cùng luật CHECK `device_port_vlan_check`.
  @IsOptional() @IsString() @Length(0, 40) vlan?: string;

  @IsOptional() @IsString() @Length(0, 500) @NoSecretText() note?: string;

  /** Loại dây (danh mục `cable_type`); `''` = bỏ loại dây. */
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() cableTypeId?: string;
}

/** Danh sách cổng vật lý của một máy (Q-26) — `PATCH :id/port-layout`. */
export class PortLayoutBodyDto {
  /** Từng cổng do `normalizePortLayout` kiểm (tên, kiểu, trùng, trần). */
  @IsArray({ message: 'Danh sách cổng phải là một mảng.' }) ports!: unknown[];
}

/** Một sợi dây giữa hai máy có hồ sơ — hộp "Khai kết nối" của sơ đồ mạng (Q-23). */
export class LinkBodyDto {
  @IsString() @Length(1, 60) portLabel!: string;
  @IsUUID(undefined, { message: 'Thiết bị đầu kia không hợp lệ.' }) connectedDeviceId!: string;
  @IsOptional() @IsString() @Length(0, 60) connectedPort?: string;
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() cableTypeId?: string;
}

export class BulkLinkBodyDto {
  @IsString() @Length(1, 60) startPort!: string;
  @IsOptional() @IsString() @Length(0, 60) endPort?: string;
  @IsArray()
  @ArrayMinSize(1, { message: 'Chưa chọn máy nào để nối.' })
  @ArrayMaxSize(BULK_LINK_MAX, { message: `Một lượt nối tối đa ${BULK_LINK_MAX} máy.` })
  @IsUUID(undefined, { each: true, message: 'Thiết bị đầu kia không hợp lệ.' })
  targets!: string[];
  @IsOptional() @IsString() @Length(0, 60) peerPort?: string;
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() cableTypeId?: string;
}

class BulkPlanQueryDto {
  @IsString() @Length(1, 60) startPort!: string;
  @IsOptional() @IsString() @Length(0, 60) endPort?: string;
  @Matches(/^[1-9]\d{0,2}$/, { message: 'Số máy không hợp lệ.' }) count!: string;
}

class PortParamDto extends IdParamDto {
  @IsUUID(undefined, { message: 'Mã dòng port map không hợp lệ.' })
  portId!: string;
}

/**
 * Kho thiết bị (FR-001/FR-007).
 *
 * Quyền: mọi vai đã đăng nhập đều ĐỌC và GHI được hồ sơ thiết bị — đây là việc hàng ngày
 * của cả team IT (story viết "As a Member"). Thứ chỉ Admin/SA đụng là DANH MỤC.
 * Không có endpoint DELETE: thiết bị chỉ đổi trạng thái sang "đã thanh lý".
 */
@NoStepUp()
@Feature('assets')
@Controller('api/v1/devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly ports: DevicePortsService,
    private readonly panels: DevicePanelRegistry,
    private readonly imports: DeviceImportService,
    private readonly timelines: DeviceTimelineRegistry,
    private readonly users: UsersApiService,
    private readonly config: SystemConfigService,
  ) {}

  @Roles('sa', 'admin', 'member')
  @FeatureFree()
  @Get()
  list(
    @Query() query: DeviceListQueryDto,
  ) {
    return this.devices.list(
      parsePageQuery(query),
      {
        search: query.search,
        siteId: query.siteId,
        cabinetId: query.cabinetId,
        deviceTypeId: query.deviceTypeId,
        deviceTypeIds: splitUuidList(query.deviceTypeIds),
        status: deviceStatusQuery(query.status),
        // So với chuỗi 'true', không ép boolean: `?usable=false` phải nghĩa là KHÔNG lọc.
        usableOnly: query.usable === 'true',
        department: query.department,
        assignedTo: query.assignedTo,
      },
      parseSortQuery(query, DEVICE_SORT_KEYS, DEVICE_SORT_DEFAULT),
    );
  }

  /**
   * File mẫu + export + import. ĐẶT TRƯỚC `@Get(':id')`: Nest khớp route theo
   * thứ tự khai báo, để sau thì `/devices/template` bị `:id` nuốt và trả 400 "id không hợp lệ".
   */
  @Roles('sa', 'admin', 'member')
  @Get('template')
  async template(@Res() res: Response) {
    sendXlsx(res, await this.imports.buildTemplate(), 'mau-thiet-bi.xlsx');
  }

  /**
   * FR-028: xuất đúng bộ lọc đang xem, không phải cả kho.
   *
   * `@Audited` vì AC 7.2 đòi ghi vết mỗi lần xuất: "ai kéo cả kho thiết bị ra file" là
   * câu đáng trả lời được. Interceptor chỉ ghi method + path, KHÔNG ghi query string —
   * nếp cũ của `AuditInterceptor`, và đừng nới ra vì query là nơi dễ lọt thứ không nên ghi.
   */
  @Roles('sa', 'admin', 'member')
  @Audited('devices.exported', 'device')
  @Get('export')
  async export(
    @Query() query: DeviceExportQueryDto,
    @Res() res: Response,
  ) {
    const buffer = await this.imports.buildExport(
      {
        search: query.search,
        siteId: query.siteId,
        cabinetId: query.cabinetId,
        deviceTypeId: query.deviceTypeId,
        department: query.department,
        assignedTo: query.assignedTo,
        // Cùng cách đọc với danh sách: file xuất khớp đúng cái đang xem (FR-028).
        status: deviceStatusQuery(query.status),
      },
      parseSortQuery(query, DEVICE_SORT_KEYS, DEVICE_SORT_DEFAULT),
    );
    sendXlsx(res, buffer, 'thiet-bi.xlsx');
  }

  /** Bảng đối chiếu — KHÔNG ghi gì. */
  @Roles('sa', 'admin', 'member')
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', { limits: XLSX_UPLOAD_LIMIT }))
  previewImport(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.imports.preview(requireXlsx(file));
  }

  /** Dòng lỗi của lượt đối chiếu ra Excel (ADM-005) — chỉ đọc lại file vừa gửi, không ghi gì. */
  @Roles('sa', 'admin', 'member')
  @Post('import/errors')
  @UseInterceptors(FileInterceptor('file', { limits: XLSX_UPLOAD_LIMIT }))
  async importErrors(@UploadedFile() file: Express.Multer.File | undefined, @Res() res: Response) {
    sendXlsx(res, await this.imports.errorsFile(requireXlsx(file)), 'dong-loi-thiet-bi.xlsx');
  }

  @Roles('sa', 'admin', 'member')
  @Post('import/commit')
  @Audited('device.imported', 'device', { writtenByService: true })
  @UseInterceptors(FileInterceptor('file', { limits: XLSX_UPLOAD_LIMIT }))
  commitImport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.imports.commit(actor(req), requireXlsx(file));
  }

  /** Mã gợi ý cho form Thêm (FM-21). ĐẶT TRƯỚC `@Get(':id')`. */
  @Roles('sa', 'admin', 'member')
  @Get('next-code')
  async nextCode() {
    return { code: await this.devices.suggestCode() };
  }

  @Roles('sa', 'admin', 'member')
  @Feature('assets', 'network')
  @Get(':id')
  findOne(@Param() params: IdParamDto) {
    return this.devices.findOne(params.id);
  }

  /**
   * Khu mở rộng: IP, license, secret, phiếu… Không module nào đăng ký thì trả mảng RỖNG — UI
   * ẩn gọn. Module mới chỉ thêm provider, không sửa gì ở đây (AD-2).
   */
  @Roles('sa', 'admin', 'member')
  @Get(':id/panels')
  panelsFor(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    /* Truyền NGƯỜI ĐANG XEM xuống provider: khu "Két sắt" phải tự hỏi ma trận quyền, và
       trước 17/09/2026 nó không có gì để hỏi (xem `common/device-panels.ts`). */
    return this.panels.listFor(params.id, {
      email: req.user!.email,
      role: req.user!.role,
      features: req.user!.features,
    });
  }

  @Roles('sa', 'admin', 'member')
  @Get(':id/history')
  async history(@Param() params: IdParamDto) {
    // Họ tên người làm (email vào tooltip) — một lượt hỏi cho cả trang, qua users.api (AD-2).
    return withActorNames(await this.devices.history(params.id), (emails) =>
      this.users.namesByEmails(emails),
    );
  }

  /**
   * Sự kiện của module KHÁC về máy này (IP, license) — tab Lịch sử gộp với lịch sử hồ sơ để
   * trả lời "máy này từng dùng key nào, IP nào" ở một chỗ (DEV-086). Cùng trần với panel.
   */
  @Roles('sa', 'admin', 'member')
  @Get(':id/timeline')
  async timeline(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    const timeline = await this.timelines.timelineFor(params.id, HISTORY_PAGE_LIMIT, req.user!.features);
    return {
      ...timeline,
      items: await withActorNames(timeline.items, (emails) => this.users.namesByEmails(emails)),
    };
  }

  @Roles('sa', 'admin', 'member')
  @Post()
  @Audited('device.created', 'device', { writtenByService: true })
  create(@Body() body: DeviceBodyDto, @Req() req: AuthedRequest) {
    return this.devices.create(actor(req), body);
  }

  @Roles('sa', 'admin', 'member')
  @Feature('assets', 'network')
  @Patch(':id')
  @Audited('device.updated', 'device', { writtenByService: true })
  update(
    @Param() params: IdParamDto,
    @Body() body: DeviceBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.devices.update(actor(req), params.id, body);
  }

  /**
   * Thao tác hàng loạt (UX-E25): cùng vai với đổi tay; một transaction cho cả lô, mỗi máy một
   * dòng lịch sử + nhật ký như làm tay.
   */
  @Roles('sa', 'admin', 'member')
  @Post('bulk/status')
  @Audited('device.status-changed', 'device', { writtenByService: true })
  bulkStatus(@Body() body: BulkStatusDto, @Req() req: AuthedRequest) {
    return this.devices.bulkSetStatus(actor(req), body.ids, body.status);
  }

  @Roles('sa', 'admin', 'member')
  @Post('bulk/update')
  @Audited('device.updated', 'device', { writtenByService: true })
  bulkUpdate(@Body() body: BulkUpdateDto, @Req() req: AuthedRequest) {
    if (body.assignedTo === undefined && body.department === undefined) {
      throw new BadRequestException({ code: 'FIELD_REQUIRED', message: 'Chọn ít nhất một ô để đổi: người dùng hoặc phòng ban.' });
    }
    return this.devices.bulkUpdate(actor(req), body.ids, { assignedTo: body.assignedTo, department: body.department });
  }

  @Roles('sa', 'admin', 'member')
  @Patch(':id/status')
  @Audited('device.status-changed', 'device', { writtenByService: true })
  async setStatus(
    @Param() params: IdParamDto,
    @Body() body: StatusDto,
    @Req() req: AuthedRequest,
  ) {
    await this.devices.setStatus(actor(req), params.id, body.status, {
      cleanup: body.cleanup ?? false,
    });
    return { status: body.status };
  }
  // ───────────── Port map (AD-14) ─────────────

  /**
   * Trả CẢ HAI CHIỀU: `ports` là cổng của chính thiết bị này, `incoming` là cổng ở nơi khác
   * đang cắm vào nó — dựng bằng query, không có bản ghi đối xứng nào trong DB (AD-14).
   */
  @Roles('sa', 'admin', 'member')
  @Feature('assets', 'network')
  @Get(':id/ports')
  listPorts(@Param() params: IdParamDto) {
    return this.ports.listFor(params.id);
  }

  /** Mặt cổng (Q-26): cổng vật lý của máy, cổng nào đang có dây và đầu kia. Chỉ đọc. */
  @Roles('sa', 'admin', 'member')
  @Feature('assets', 'network')
  @Get(':id/port-panel')
  portPanel(@Param() params: IdParamDto) {
    return this.ports.panel(params.id);
  }

  /** Sửa danh sách cổng (thêm cổng riêng, bỏ cổng không dây) — cùng quyền với sửa sơ đồ cổng. */
  @Roles('sa', 'admin', 'member')
  @Feature('assets', 'network')
  @Patch(':id/port-layout')
  @Audited('device.ports-layout', 'device', { writtenByService: true })
  async setPortLayout(@Param() params: IdParamDto, @Body() body: PortLayoutBodyDto, @Req() req: AuthedRequest) {
    return this.ports.setLayout(actor(req), params.id, body.ports, await this.config.getNumber('devicePortTemplateMax'));
  }

  /**
   * Khai một sợi dây giữa hai máy (sơ đồ mạng — Q-23 "vẽ là khai, có hỏi"). Cổng đã có dòng
   * trống thì nối dòng đó, nên một lượt có thể là thêm hoặc sửa dòng.
   */
  @Roles('sa', 'admin', 'member')
  @Feature('assets', 'network')
  @Post(':id/ports/link')
  @Audited(['device.port-added', 'device.port-updated'], 'device', { writtenByService: true })
  linkPort(@Param() params: IdParamDto, @Body() body: LinkBodyDto, @Req() req: AuthedRequest) {
    return this.ports.link(actor(req), params.id, body);
  }

  /** Bảng xem trước "máy → cổng" của Nối hàng loạt. Chỉ đọc. */
  @Roles('sa', 'admin', 'member')
  @Feature('assets', 'network')
  @Get(':id/ports/bulk-plan')
  bulkPlan(@Param() params: IdParamDto, @Query() query: BulkPlanQueryDto) {
    const count = Number(query.count);
    if (count > BULK_LINK_MAX) {
      throw new BadRequestException({ code: 'BULK_LINK_TOO_MANY', message: `Một lượt nối tối đa ${BULK_LINK_MAX} máy.` });
    }
    return this.ports.bulkPlan(params.id, { startPort: query.startPort, endPort: query.endPort, count });
  }

  /** Nối một switch với N máy trong MỘT transaction — thiếu cổng hay vướng luật thì không ghi máy nào. */
  @Roles('sa', 'admin', 'member')
  @Feature('assets', 'network')
  @Post(':id/ports/bulk-link')
  @Audited(['device.port-added', 'device.port-updated'], 'device', { writtenByService: true })
  bulkLink(@Param() params: IdParamDto, @Body() body: BulkLinkBodyDto, @Req() req: AuthedRequest) {
    return this.ports.bulkLink(actor(req), params.id, body);
  }

  @Roles('sa', 'admin', 'member')
  @Feature('assets', 'network')
  @Post(':id/ports')
  @Audited('device.port-added', 'device', { writtenByService: true })
  addPort(
    @Param() params: IdParamDto,
    @Body() body: PortBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.ports.create(actor(req), params.id, body);
  }

  @Roles('sa', 'admin', 'member')
  @Feature('assets', 'network')
  @Patch(':id/ports/:portId')
  @Audited('device.port-updated', 'device', { writtenByService: true })
  updatePort(
    @Param() params: PortParamDto,
    @Body() body: PortBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.ports.update(actor(req), params.id, params.portId, body);
  }

  /** Gỡ sợi dây của một dòng; dòng còn VLAN/người dùng/ghi chú thì giữ dòng, chỉ bỏ đầu kia. */
  @Roles('sa', 'admin', 'member')
  @Feature('assets', 'network')
  @Post(':id/ports/:portId/unlink')
  @Audited(['device.port-updated', 'device.port-removed'], 'device', { writtenByService: true })
  unlinkPort(@Param() params: PortParamDto, @Req() req: AuthedRequest) {
    return this.ports.unlink(actor(req), params.id, params.portId);
  }

  @Roles('sa', 'admin', 'member')
  @Feature('assets', 'network')
  @Delete(':id/ports/:portId')
  @Audited('device.port-removed', 'device', { writtenByService: true })
  async removePort(@Param() params: PortParamDto, @Req() req: AuthedRequest) {
    await this.ports.remove(actor(req), params.id, params.portId);
    return { status: 'deleted' };
  }
}

function actor(req: AuthedRequest): string {
  return req.user!.email;
}


