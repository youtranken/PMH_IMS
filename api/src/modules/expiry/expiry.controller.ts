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
import type { Response } from 'express';
import {
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
} from 'class-validator';
import { Audited } from '../audit/audited.decorator';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { sendXlsx } from '../../common/excel/xlsx-http';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { ExpiryDigestService } from './expiry-digest.service';
import type { DigestFrequency } from './digest-schedule';
import { ExpiryService } from './expiry.service';

class RenewDto {
  @IsString() @Length(1, 40) kind!: string;

  // @IsUUID chứ không phải regex 36 ký tự: regex nhận cả 36 dấu gạch ngang, lọt xuống
  // Postgres và bung 500 thay vì 400 (code review Epic 3).
  @IsUUID(undefined, { message: 'Mã hồ sơ không hợp lệ.' })
  id!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Hạn mới phải dạng YYYY-MM-DD.' })
  endDate!: string;
}

class RuleBodyDto {
  @IsOptional() @IsString() @Length(1, 160) name?: string;

  /** Mảng rỗng = mọi loại đang đăng ký. */
  @IsOptional() @IsArray() @IsString({ each: true }) kinds?: string[];

  @IsOptional() @IsInt() @Min(1) @Max(365) withinDays?: number;

  @IsOptional() @IsArray() @IsString({ each: true }) recipients?: string[];

  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'], { message: 'Tần suất không hợp lệ.' })
  frequency?: DigestFrequency;

  @IsOptional() @IsInt() @Min(0) @Max(23) hour?: number;
  @IsOptional() @IsInt() @Min(1) @Max(7) weekday?: number;
  // Giới hạn 28 để tháng nào cũng có ngày đó.
  @IsOptional() @IsInt() @Min(1) @Max(28) dayOfMonth?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class RuleParamDto {
  @IsUUID(undefined, { message: 'Mã luật không hợp lệ.' })
  id!: string;
}

/**
 * Màn Expiry tổng hợp (story 3.4, FR-012).
 * Quyền: cả team IT — ai cũng cần biết cái gì sắp hết hạn.
 */
@Controller('api/v1/expiry')
export class ExpiryController {
  constructor(
    private readonly expiry: ExpiryService,
    private readonly digest: ExpiryDigestService,
    private readonly excel: ExcelExportService,
  ) {}

  /** Các loại nguồn đang đăng ký — UI dựng bộ lọc từ đây, không viết cứng danh sách. */
  @Roles('sa', 'admin', 'member')
  @Get('kinds')
  kinds() {
    return this.expiry.kinds();
  }

  @Roles('sa', 'admin', 'member')
  @Get()
  list(@Query() query: { withinDays?: string; kinds?: string; includeExpired?: string }) {
    return this.expiry.list({
      withinDays: query.withinDays ? Number(query.withinDays) : undefined,
      // `?kinds=license,ssl` — nhiều loại một lần, tránh gọi API lặp.
      kinds: query.kinds ? query.kinds.split(',').filter(Boolean) : undefined,
      includeExpired: query.includeExpired !== 'false',
    });
  }

  /** FR-028 / AC 7.2: xuất đúng cửa sổ ngày và bộ loại đang xem. */
  @Roles('sa', 'admin', 'member')
  @Audited('expiry.exported', 'expiry')
  @Get('export.xlsx')
  async export(
    @Query() query: { withinDays?: string; kinds?: string; includeExpired?: string },
    @Res() res: Response,
  ) {
    const { items } = await this.expiry.list({
      withinDays: query.withinDays ? Number(query.withinDays) : undefined,
      kinds: query.kinds ? query.kinds.split(',').filter(Boolean) : undefined,
      includeExpired: query.includeExpired !== 'false',
    });
    const buffer = await this.excel.build({
      sheetName: 'Sap het han',
      columns: [
        { header: 'Loại', width: 18, value: (r) => r.kind },
        { header: 'Tên', width: 36, value: (r) => r.label },
        { header: 'Chi tiết', width: 28, value: (r) => r.sublabel ?? '' },
        { header: 'Bắt đầu', width: 14, value: (r) => r.start ?? '' },
        { header: 'Hết hạn', width: 14, value: (r) => r.end },
        // Số ÂM = đã quá hạn. Giữ nguyên dấu chứ không đổi thành chữ: người nhận file thường
        // sắp xếp theo cột này, và "quá hạn 200 ngày" phải nằm trên cùng.
        { header: 'Còn (ngày)', width: 12, value: (r) => r.daysLeft },
      ],
      rows: items,
    });
    sendXlsx(res, buffer, 'sap-het-han.xlsx');
  }

  @Roles('sa', 'admin', 'member')
  @Get('renewals')
  renewals() {
    return this.expiry.recentRenewals();
  }

  // ───────────── Luật gửi báo cáo (story 3.5, FR-013) ─────────────

  /** Ai cũng XEM được luật; chỉ Admin/SA sửa — đây là thứ quyết định ai nhận email. */
  @Roles('sa', 'admin', 'member')
  @Get('rules')
  listRules() {
    return this.digest.list();
  }

  @Roles('sa', 'admin')
  @Post('rules')
  @Audited('expiry.rule.created', 'expiry_rule', { writtenByService: true })
  createRule(@Body() body: RuleBodyDto, @Req() req: AuthedRequest) {
    return this.digest.create(req.user!.email, body);
  }

  @Roles('sa', 'admin')
  @Patch('rules/:id')
  @Audited('expiry.rule.updated', 'expiry_rule', { writtenByService: true })
  updateRule(
    @Param() params: RuleParamDto,
    @Body() body: RuleBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.digest.update(req.user!.email, params.id, body);
  }

  @Roles('sa', 'admin')
  @Delete('rules/:id')
  @Audited('expiry.rule.deleted', 'expiry_rule', { writtenByService: true })
  async removeRule(@Param() params: RuleParamDto, @Req() req: AuthedRequest) {
    await this.digest.remove(req.user!.email, params.id);
    return { status: 'deleted' };
  }

  /** Gửi thử ngay, không đụng mốc kỳ — khỏi phải chờ tới thứ Hai mới biết luật có chạy. */
  @Roles('sa', 'admin')
  @Post('rules/:id/test')
  @Audited('expiry.digest.test', 'expiry_rule', { writtenByService: true })
  testRule(@Param() params: RuleParamDto, @Req() req: AuthedRequest) {
    return this.digest.sendTest(req.user!.email, params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Post('renew')
  @Audited('expiry.renewed', 'expiry', { writtenByService: true })
  async renew(@Body() body: RenewDto, @Req() req: AuthedRequest) {
    await this.expiry.renew(req.user!.email, body.kind, body.id, body.endDate);
    return { status: 'renewed' };
  }
}
