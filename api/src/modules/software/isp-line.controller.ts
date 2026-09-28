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
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';
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

/** Ngày lịch dạng YYYY-MM-DD; chuỗi rỗng nghĩa là XÓA ngày đang có. */
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})?$/;

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

  @IsOptional() @Matches(DATE_ONLY, { message: 'Ngày bắt đầu phải dạng YYYY-MM-DD.' })
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
 * Đường truyền ISP (story 3.3, FR-010).
 * Quyền: cả team IT — đứt cáp lúc 2 giờ sáng thì ai trực cũng phải tra được hotline.
 */
@NoStepUp()
@Controller('api/v1/isp-lines')
export class IspLineController {
  constructor(
    private readonly isp: IspLineService,
    private readonly excel: ExcelExportService,
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
      status?: IspStatus;
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
      status?: IspStatus;
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
      sheetName: 'Duong truyen',
      columns: [
        { header: 'Mã', width: 18, value: (r) => r.code },
        { header: 'Nhà mạng', width: 22, value: (r) => r.provider },
        { header: 'Băng thông', width: 14, value: (r) => r.bandwidth ?? '' },
        { header: 'IP WAN', width: 18, value: (r) => r.wanIp ?? '' },
        { header: 'Hotline', width: 16, value: (r) => r.hotline ?? '' },
        { header: 'Số hợp đồng', width: 20, value: (r) => r.contractNo ?? '' },
        { header: 'Bắt đầu', width: 14, value: (r) => r.startDate ?? '' },
        { header: 'Trạng thái', width: 16, value: (r) => ISP_STATUS_LABEL[r.status] ?? r.status },
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
  history(@Param() params: IdParamDto) {
    return this.isp.history(params.id);
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
