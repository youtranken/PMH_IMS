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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Validate,
  ValidateIf,
} from 'class-validator';
import { NoSecretText } from '../../common/no-secret-text';
import { RealDateOrEmpty } from '../../common/real-date';
import { parsePageQuery } from '../../common/pagination';
import { parseSortQuery } from '../../common/sorting';
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
import { DevicePortsService } from './device-ports.service';
import {
  DEVICE_SORT_DEFAULT,
  DEVICE_SORT_KEYS,
  DevicesService,
} from './devices.service';
import { DEVICE_STATUSES, type DeviceStatus } from './devices.types';
import { NoStepUp } from '../auth/step-up.decorator';

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


export class PortBodyDto {
  @IsOptional() @IsString() @Length(1, 60) portLabel?: string;

  // Chuỗi rỗng = gỡ liên kết tới thiết bị trong kho (đầu kia thành mô tả tự do).
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() connectedDeviceId?: string;

  @IsOptional() @IsString() @Length(0, 200) connectedLabel?: string;
  @IsOptional() @IsString() @Length(0, 60) connectedPort?: string;
  @IsOptional() @IsString() @Length(0, 120) usedBy?: string;

  // VLAN của cổng: text, vì "trunk" là giá trị có thật và hay gặp nhất trên uplink.
  // Dạng hợp lệ (1–4094 | trunk) kiểm ở `portVlanOf`, cùng luật CHECK `device_port_vlan_check`.
  @IsOptional() @IsString() @Length(0, 40) vlan?: string;

  @IsOptional() @IsString() @Length(0, 500) @NoSecretText() note?: string;
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
@Controller('api/v1/devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly ports: DevicePortsService,
    private readonly panels: DevicePanelRegistry,
    private readonly imports: DeviceImportService,
    private readonly timelines: DeviceTimelineRegistry,
    private readonly users: UsersApiService,
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
      /** '?usable=true' — chỉ máy còn nhận thêm được. Xem `DeviceFilter.usableOnly`. */
      usable?: string;
      /** Khớp đúng phòng ban / người sử dụng — hộp gán license chọn cả lô (SW-053). */
      department?: string;
      assignedTo?: string;
      sort?: string;
      dir?: string;
    },
  ) {
    return this.devices.list(
      parsePageQuery(query),
      {
        search: query.search,
        siteId: query.siteId,
        cabinetId: query.cabinetId,
        deviceTypeId: query.deviceTypeId,
        status: query.status,
        // So với chuỗi 'true', không ép boolean: `?usable=false` phải nghĩa là KHÔNG lọc.
        usableOnly: query.usable === 'true',
        // `?department=a&department=b` ra MẢNG — không phải một phòng, bỏ qua thay vì nổ 500.
        department: typeof query.department === 'string' ? query.department : undefined,
        assignedTo: typeof query.assignedTo === 'string' ? query.assignedTo : undefined,
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
    @Query()
    query: {
      search?: string;
      siteId?: string;
      cabinetId?: string;
      deviceTypeId?: string;
      status?: DeviceStatus;
      sort?: string;
      dir?: string;
    },
    @Res() res: Response,
  ) {
    const buffer = await this.imports.buildExport(
      {
        search: query.search,
        siteId: query.siteId,
        cabinetId: query.cabinetId,
        deviceTypeId: query.deviceTypeId,
        status: query.status,
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

  @Roles('sa', 'admin', 'member')
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
  async timeline(@Param() params: IdParamDto) {
    const timeline = await this.timelines.timelineFor(params.id, HISTORY_PAGE_LIMIT);
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
  @Patch(':id')
  @Audited('device.updated', 'device', { writtenByService: true })
  update(
    @Param() params: IdParamDto,
    @Body() body: DeviceBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.devices.update(actor(req), params.id, body);
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
  @Get(':id/ports')
  listPorts(@Param() params: IdParamDto) {
    return this.ports.listFor(params.id);
  }

  @Roles('sa', 'admin', 'member')
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
  @Patch(':id/ports/:portId')
  @Audited('device.port-updated', 'device', { writtenByService: true })
  updatePort(
    @Param() params: PortParamDto,
    @Body() body: PortBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.ports.update(actor(req), params.id, params.portId, body);
  }

  @Roles('sa', 'admin', 'member')
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

