import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsOptional, IsString, IsUUID, Length, Validate, ValidateIf } from 'class-validator';
import { RealDateOrEmpty } from '../../common/real-date';
import { parsePageQuery } from '../../common/pagination';
import { parseSortQuery } from '../../common/sorting';
import { Audited } from '../audit/audited.decorator';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { sendXlsx } from '../../common/excel/xlsx-http';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import {
  ISP_SORT_DEFAULT,
  ISP_SORT_KEYS,
  ISP_STATUSES,
  IspLineService,
  type IspStatus,
} from './isp-line.service';
import { NoStepUp } from '../auth/step-up.decorator';
import { UsersApiService } from '../users/users.api';
import { withActorNames } from '../../common/history';
import { CatalogApiService } from '../catalog/catalog.api';
import { DevicesApiService } from '../devices/devices.api';
import { deviceIdsInHistory, withDeviceCodes } from './history-device-codes';

/**
 * KHÔNG có `endDate` (Q-04): đường truyền không có hạn. `forbidNonWhitelisted` bật toàn cục nên
 * client cũ còn gửi trường đó nhận 400 thay vì tưởng đã lưu.
 */
export class IspBodyDto {
  @IsOptional() @IsString() @Length(1, 60) code?: string;
  // Chọn từ danh mục Nhà mạng (Q-11). Tên gửi kèm bị từ chối: tên do danh mục quyết.
  @IsOptional() @IsUUID(undefined, { message: 'Nhà mạng không hợp lệ.' }) providerId?: string;
  @IsOptional() @IsString() @Length(0, 60) bandwidth?: string;
  @IsOptional() @IsString() @Length(0, 120) wanIp?: string;

  // Chuỗi rỗng = bỏ gán, nên không ép UUID trong trường hợp đó.
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() siteId?: string;
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() deviceId?: string;

  @IsOptional() @IsString() @Length(0, 60) hotline?: string;
  @IsOptional() @IsString() @Length(0, 80) contractNo?: string;

  @IsOptional() @Validate(RealDateOrEmpty, { message: 'Ngày bắt đầu phải là ngày có thật, dạng YYYY-MM-DD.' })
  startDate?: string;

  @IsOptional() @IsString() @Length(0, 2000) note?: string;

  @IsOptional()
  @IsIn([...ISP_STATUSES], { message: 'Trạng thái đường truyền không hợp lệ.' })
  status?: IspStatus;
}

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã đường truyền không hợp lệ.' })
  id!: string;
}

/**
 * Đường truyền ISP (FR-010).
 * Quyền: cả team IT — đứt cáp lúc 2 giờ sáng thì ai trực cũng phải tra được hotline.
 */
@NoStepUp()
@Controller('api/v1/isp-lines')
export class IspLineController {
  constructor(
    private readonly isp: IspLineService,
    private readonly excel: ExcelExportService,
    private readonly users: UsersApiService,
    private readonly devices: DevicesApiService,
    private readonly catalog: CatalogApiService,
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
      providerId?: string;
      status?: string;
      sort?: string;
      dir?: string;
    },
  ) {
    return this.isp.list(
      parsePageQuery(query),
      {
        search: query.search,
        siteId: query.siteId,
        providerId: query.providerId,
        status: query.status,
      },
      parseSortQuery(query, ISP_SORT_KEYS, ISP_SORT_DEFAULT),
    );
  }

  /**
   * FR-028 / AC 7.2: xuất đúng bộ lọc đang xem, cột đúng như đang hiển thị.
   *
   * Khai TRƯỚC `@Get(':id')` — Nest khớp route theo thứ tự khai báo, để sau thì `:id` nuốt mất.
   */
  @Roles('sa', 'admin', 'member')
  @Audited('isp.exported', 'isp_line')
  @Get('export.xlsx')
  async export(
    @Query()
    query: {
      search?: string;
      siteId?: string;
      providerId?: string;
      status?: string;
      sort?: string;
      dir?: string;
    },
    @Res() res: Response,
  ) {
    // `listAll` — không cắt ở một con số bịa ra; xem ghi chú ở software.controller.
    // Cùng thứ tự với màn hình (FR-028): export phải khớp đúng cái đang nhìn thấy.
    const rows = await this.isp.listAll(
      {
        search: query.search,
        siteId: query.siteId,
        providerId: query.providerId,
        status: query.status,
      },
      parseSortQuery(query, ISP_SORT_KEYS, ISP_SORT_DEFAULT),
    );
    const buffer = await this.excel.build({
      sheetName: 'Đường truyền',
      columns: [
        { header: 'Mã', width: 18, value: (r) => r.code },
        { header: 'Nhà mạng', width: 22, value: (r) => r.provider },
        { header: 'Băng thông', width: 14, value: (r) => r.bandwidth ?? '' },
        { header: 'IP WAN', width: 18, value: (r) => r.wanIp ?? '' },
        { header: 'Site', width: 12, value: (r) => r.siteCode ?? '' },
        { header: 'Thiết bị biên', width: 18, value: (r) => r.deviceCode ?? '' },
        { header: 'Hotline', width: 16, value: (r) => r.hotline ?? '' },
        { header: 'Số hợp đồng', width: 20, value: (r) => r.contractNo ?? '' },
        { header: 'Bắt đầu', width: 14, value: (r) => r.startDate ?? '' },
        { header: 'Trạng thái', width: 16, value: (r) => ISP_STATUS_LABEL[r.status] ?? r.status },
        { header: 'Ghi chú', width: 30, value: (r) => r.note ?? '' },
      ],
      rows,
    });
    sendXlsx(res, buffer, 'duong-truyen.xlsx');
  }

  @Roles('sa', 'admin', 'member')
  @Get(':id')
  findOne(@Param() params: IdParamDto) {
    return this.isp.findOne(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Get(':id/history')
  async history(@Param() params: IdParamDto) {
    const rows = await this.isp.history(params.id);
    // Đổi site / thiết bị: sổ lưu id (mã có thể đổi), lúc đọc mới tra ra MÃ để dòng lịch sử
    // nói "HCM → HN" thay vì "đã đổi" (NET-067). Site gồm cả mục đã ngừng dùng.
    const deviceIds = deviceIdsInHistory(rows);
    const deviceCodes = new Map<string, string>();
    if (deviceIds.length > 0) {
      for (const [id, device] of await this.devices.getByIds(deviceIds)) {
        deviceCodes.set(id, device.code);
      }
    }
    const siteCodes = new Map<string, string>();
    if (deviceIdsInHistory(rows, 'siteId').length > 0) {
      for (const site of (await this.catalog.lists({ includeInactive: true })).sites) {
        siteCodes.set(site.id, site.code);
      }
    }
    const labelled = withDeviceCodes(
      withDeviceCodes(rows, deviceCodes),
      siteCodes,
      'siteId',
      'site',
    );
    return withActorNames(labelled, (emails) => this.users.namesByEmails(emails));
  }

  @Roles('sa', 'admin', 'member')
  @Post()
  @Audited('isp.created', 'isp_line', { writtenByService: true })
  create(@Body() body: IspBodyDto, @Req() req: AuthedRequest) {
    return this.isp.create(actor(req), body);
  }

  @Roles('sa', 'admin', 'member')
  @Patch(':id')
  @Audited('isp.updated', 'isp_line', { writtenByService: true })
  update(@Param() params: IdParamDto, @Body() body: IspBodyDto, @Req() req: AuthedRequest) {
    return this.isp.update(actor(req), params.id, body);
  }
}

function actor(req: AuthedRequest): string {
  return req.user!.email;
}

/** Cùng chữ với màn `/isp-lines` (`isp.status*` trong `web/src/locales/vi.ts`). */
const ISP_STATUS_LABEL: Record<string, string> = {
  active: 'Đang dùng',
  suspended: 'Tạm ngưng',
  terminated: 'Đã thanh lý',
};
