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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Validate,
  ValidateIf,
} from 'class-validator';
import { NoSecretText } from '../../common/no-secret-text';
import { IsPhone } from '../../common/phone';
import { RealDateOrEmpty } from '../../common/real-date';
import { parsePageQuery } from '../../common/pagination';
import { parseSortQuery } from '../../common/sorting';
import { Audited } from '../audit/audited.decorator';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { ISP_EXPORT_COLUMNS } from './isp-import';
import { requireXlsx, sendXlsx, XLSX_UPLOAD_LIMIT } from '../../common/excel/xlsx-http';
import { IspImportService } from './isp-import.service';
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
import { IspExportQueryDto, IspListQueryDto } from './list-query.dto';
import { UsersApiService } from '../users/users.api';
import { withActorNames } from '../../common/history';
import { CatalogApiService } from '../catalog/catalog.api';
import { DevicesApiService } from '../devices/devices.api';
import { deviceIdsInHistory, withDeviceCodes } from './history-device-codes';
import { MAX_WAN_IPS } from './wan-ip';
import { Feature } from '../auth/feature.decorator';

/**
 * KHÔNG có `endDate` (Q-04): đường truyền không có hạn. `forbidNonWhitelisted` bật toàn cục nên
 * client cũ còn gửi trường đó nhận 400 thay vì tưởng đã lưu.
 */
export class IspBodyDto {
  @IsOptional() @IsString() @Length(1, 60) code?: string;
  // Chọn từ danh mục Nhà mạng (Q-11). Tên gửi kèm bị từ chối: tên do danh mục quyết.
  @IsOptional() @IsUUID(undefined, { message: 'Nhà mạng không hợp lệ.' }) providerId?: string;
  @IsOptional() @IsString() @Length(0, 60) bandwidth?: string;
  // Nhiều IPv4 đơn (Q-20). DTO chỉ chặn hình dạng + trần; từng IP do `wanIpsOf` kiểm để trả
  // thông báo nêu đúng IP sai.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_WAN_IPS, { message: `Một đường truyền ghi tối đa ${MAX_WAN_IPS} IP WAN.` })
  @IsString({ each: true })
  @Length(0, 45, { each: true })
  wanIps?: string[];

  // Chuỗi rỗng = bỏ gán, nên không ép UUID trong trường hợp đó.
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() siteId?: string;
  @IsOptional() @ValidateIf((_o, value) => value !== '') @IsUUID() deviceId?: string;

  @IsOptional() @IsPhone(60) hotline?: string;
  @IsOptional() @IsString() @Length(0, 80) contractNo?: string;

  @IsOptional() @Validate(RealDateOrEmpty, { message: 'Ngày bắt đầu phải là ngày có thật, dạng YYYY-MM-DD.' })
  startDate?: string;

  @IsOptional() @IsString() @Length(0, 2000) @NoSecretText() note?: string;

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
@Feature('assets')
@Controller('api/v1/isp-lines')
export class IspLineController {
  constructor(
    private readonly isp: IspLineService,
    private readonly excel: ExcelExportService,
    private readonly users: UsersApiService,
    private readonly devices: DevicesApiService,
    private readonly catalog: CatalogApiService,
    private readonly imports: IspImportService,
  ) {}

  @Roles('sa', 'admin', 'member')
  @Feature('assets', 'network')
  @Get()
  list(
    @Query() query: IspListQueryDto,
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
    @Query() query: IspExportQueryDto,
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
      columns: ISP_EXPORT_COLUMNS,
      rows,
    });
    sendXlsx(res, buffer, 'duong-truyen.xlsx');
  }

  /** Mã gợi ý cho form Thêm (FM-21). ĐẶT TRƯỚC `@Get(':id')`. */
  @Roles('sa', 'admin', 'member')
  @Get('next-code')
  async nextCode() {
    return { code: await this.isp.suggestCode() };
  }

  /**
   * Nhập từ Excel (UX-E30). ĐẶT TRƯỚC `@Get(':id')` như file Xuất. Cùng vai với Thêm / Sửa tay:
   * file là một lối thêm / sửa nữa, không rộng quyền hơn form.
   */
  @Roles('sa', 'admin', 'member')
  @Get('template')
  async template(@Res() res: Response) {
    sendXlsx(res, await this.imports.template(), 'mau-duong-truyen.xlsx');
  }

  /** Bảng đối chiếu — KHÔNG ghi gì. */
  @Roles('sa', 'admin', 'member')
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', { limits: XLSX_UPLOAD_LIMIT }))
  previewImport(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.imports.preview(requireXlsx(file));
  }

  @Roles('sa', 'admin', 'member')
  @Post('import/errors')
  @UseInterceptors(FileInterceptor('file', { limits: XLSX_UPLOAD_LIMIT }))
  async importErrors(@UploadedFile() file: Express.Multer.File | undefined, @Res() res: Response) {
    sendXlsx(res, await this.imports.errorsFile(requireXlsx(file)), 'dong-loi-duong-truyen.xlsx');
  }

  @Roles('sa', 'admin', 'member')
  @Post('import/commit')
  @Audited('isp.imported', 'isp_line', { writtenByService: true })
  @UseInterceptors(FileInterceptor('file', { limits: XLSX_UPLOAD_LIMIT }))
  commitImport(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: AuthedRequest) {
    return this.imports.commit(actor(req), requireXlsx(file));
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

