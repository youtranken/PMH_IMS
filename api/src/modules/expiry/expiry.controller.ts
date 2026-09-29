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
  ServiceUnavailableException,
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
  Max,
  Min,
  Validate,
  ValidateIf,
} from 'class-validator';
import { RealDate } from '../../common/real-date';
import { Audited } from '../audit/audited.decorator';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { sendXlsx } from '../../common/excel/xlsx-http';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { ExpiryDigestService } from './expiry-digest.service';
import type { DigestFrequency } from './digest-schedule';
import { parsePageQuery } from '../../common/pagination';
import type { ExpiryFilterState, ExpirySort } from './expiry.service';
import { EXPIRY_SORTS, ExpiryService } from './expiry.service';
import { NoStepUp } from '../auth/step-up.decorator';
import { NoIdleTouch } from '../auth/no-idle-touch.decorator';
import { withActorNames } from '../../common/history';
import { UsersApiService } from '../users/users.api';

/** Khoảng ngày của tab "Đã gia hạn" — ngày lịch YYYY-MM-DD, cả hai bao gồm. */
class RenewalsQueryDto {
  @IsOptional()
  @Validate(RealDate, { message: '"Từ ngày" phải là ngày có thật, dạng YYYY-MM-DD.' })
  from?: string;

  @IsOptional()
  @Validate(RealDate, { message: '"Đến ngày" phải là ngày có thật, dạng YYYY-MM-DD.' })
  to?: string;
}

class RenewDto {
  @IsString() @Length(1, 40) kind!: string;

  // @IsUUID chứ không phải regex 36 ký tự: regex nhận cả 36 dấu gạch ngang, lọt xuống
  // Postgres và bung 500 thay vì 400.
  @IsUUID(undefined, { message: 'Mã hồ sơ không hợp lệ.' })
  id!: string;

  @Validate(RealDate, { message: 'Hạn mới phải là ngày có thật, dạng YYYY-MM-DD.' })
  endDate!: string;

  /**
   * Hợp đồng + chi phí của RIÊNG lượt gia hạn này, vào sổ gia hạn (Q-15). Cùng ràng buộc với
   * `RenewDto` của phần mềm; module chủ kiểm tiếp trần 2^53 của tiền.
   */
  @IsOptional() @IsString() @Length(0, 200) contract?: string;

  @IsOptional() @ValidateIf((_o, value) => value !== null) @Min(0) @IsInt()
  cost?: number | null;
}

class RuleBodyDto {
  @IsOptional() @IsString() @Length(1, 160) name?: string;

  /** Mảng rỗng = mọi loại đang đăng ký. */
  @IsOptional() @IsArray() @IsString({ each: true }) kinds?: string[];

  @IsOptional() @Min(1) @Max(365) @IsInt() withinDays?: number;

  @IsOptional() @IsArray() @IsString({ each: true }) recipients?: string[];

  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'], { message: 'Tần suất không hợp lệ.' })
  frequency?: DigestFrequency;

  @IsOptional() @Min(0) @Max(23) @IsInt() hour?: number;
  @IsOptional() @Min(1) @Max(7) @IsInt() weekday?: number;
  // Giới hạn 28 để tháng nào cũng có ngày đó.
  @IsOptional() @Min(1) @Max(28) @IsInt() dayOfMonth?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class TestRuleDto {
  /** Chỉ gửi thư thử cho chính người bấm (EX-021). */
  @IsOptional() @IsBoolean() onlyMe?: boolean;
}

class RuleParamDto {
  @IsUUID(undefined, { message: 'Mã luật không hợp lệ.' })
  id!: string;
}

/**
 * Màn Expiry tổng hợp (FR-012).
 * Quyền: cả team IT — ai cũng cần biết cái gì sắp hết hạn.
 */
@NoStepUp()
@Controller('api/v1/expiry')
export class ExpiryController {
  constructor(
    private readonly expiry: ExpiryService,
    private readonly digest: ExpiryDigestService,
    private readonly excel: ExcelExportService,
    private readonly users: UsersApiService,
  ) {}

  /** Các loại nguồn đang đăng ký — UI dựng bộ lọc từ đây, không viết cứng danh sách. */
  @Roles('sa', 'admin', 'member')
  @Get('kinds')
  kinds() {
    return this.expiry.kinds();
  }

  /**
   * Hai ngưỡng "sắp hết hạn" đang hiệu lực (AD-11, 0041).
   *
   * Có endpoint riêng vì `ExpiryBadge` và `WarrantyTimeline` xuất hiện ở MỌI màn — thiết bị,
   * phần mềm, tài khoản dịch vụ, đường truyền, bảng điều khiển — chứ không riêng màn Sắp hết
   * hạn. Không có cửa này thì web buộc phải giữ bản sao của hai con số, và bản sao đó lệch
   * lúc nào không ai biết (đúng lỗi đang vá).
   */
  @Roles('sa', 'admin', 'member')
  @Get('thresholds')
  thresholds() {
    return this.expiry.thresholds();
  }

  /**
   * CỬA CỦA MÀN HÌNH — LUÔN PHÂN TRANG (N-01).
   *
   * `parsePageQuery` mặc định `page=1, limit=50`, nên một client KHÔNG gửi gì vẫn nhận đúng
   * một trang. Đó là chủ ý: để mặc định là "trọn bộ" thì chỉ client biết gửi `limit` mới được
   * phân trang, còn client quên gửi vẫn kéo hàng nghìn dòng — và không gì đỏ để ai biết.
   *
   * Đường `export.xlsx` bên dưới CỐ Ý không truyền `page`/`limit`: file Excel phải đủ dòng, và
   * một file thiếu dòng trông y hệt một file đủ.
   */
  @Roles('sa', 'admin', 'member')
  @Get()
  list(
    @Query()
    query: {
      withinDays?: string;
      kinds?: string;
      includeExpired?: string;
      page?: string;
      limit?: string;
      state?: string;
      sort?: string;
      dir?: string;
    },
  ) {
    const paging = parsePageQuery(query);
    return this.expiry.list({
      withinDays: query.withinDays ? Number(query.withinDays) : undefined,
      // `?kinds=license,ssl` — nhiều loại một lần, tránh gọi API lặp.
      kinds: query.kinds ? query.kinds.split(',').filter(Boolean) : undefined,
      includeExpired: query.includeExpired !== 'false',
      page: paging.page,
      limit: paging.limit,
      /*
       * Giá trị lạ coi như KHÔNG LỌC, không phải "lọc ra rỗng".
       *
       * `?state=Gap` (gõ tay, bookmark cũ, một bản web cũ) mà trả bảng rỗng thì người đọc kết
       * luận "không có mục nào gấp" — một câu SAI đọc y hệt câu đúng. Bỏ qua bộ lọc thì họ
       * thấy nhiều hơn mong đợi, và đó là kiểu sai tự lộ ra.
       */
      state: isExpiryState(query.state) ? query.state : undefined,
      ...sortOf(query),
    });
  }

  /** FR-028 / AC 7.2: xuất đúng cửa sổ ngày và bộ loại đang xem. */
  @Roles('sa', 'admin', 'member')
  @Audited('expiry.exported', 'expiry')
  @Get('export.xlsx')
  async export(
    @Query()
    query: {
      withinDays?: string;
      kinds?: string;
      includeExpired?: string;
      state?: string;
      sort?: string;
      dir?: string;
    },
    @Res() res: Response,
  ) {
    // Ô số đang bật ("Gấp") cũng là bộ lọc đang xem — file xuất phải theo nó (FR-028).
    const state = isExpiryState(query.state) ? query.state : undefined;
    const { items, failedKinds } = await this.expiry.list({
      withinDays: query.withinDays ? Number(query.withinDays) : undefined,
      kinds: query.kinds ? query.kinds.split(',').filter(Boolean) : undefined,
      includeExpired: query.includeExpired !== 'false',
      state,
      // File theo đúng thứ tự đang xem trên màn (FR-028).
      ...sortOf(query),
    });
    // File thiếu dòng trông y hệt file đủ dòng — thà không xuất còn hơn xuất thiếu.
    if (failedKinds.length > 0) {
      throw new ServiceUnavailableException({
        code: 'EXPIRY_SOURCE_FAILED',
        message: `Không đọc được nguồn hạn: ${failedKinds.join(', ')}. Thử xuất lại sau.`,
      });
    }
    /**
     * Nhãn loại lấy từ sổ đăng ký nguồn hạn, không in mã máy.
     *
     * Màn hình hiện "Bảo hành thiết bị"; file xuất mà in `warranty` thì auditor cầm hai tờ
     * giấy nói hai thứ khác nhau về cùng một dòng.
     */
    const kindLabel = new Map(this.expiry.kinds().map((k) => [k.kind, k.label]));
    const buffer = await this.excel.build({
      sheetName: 'Sắp hết hạn',
      columns: [
        { header: 'Loại', width: 18, value: (r) => kindLabel.get(r.kind) ?? r.kind },
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
    sendXlsx(res, buffer, state ? `sap-het-han-${EXPORT_SUFFIX[state]}.xlsx` : 'sap-het-han.xlsx');
  }

  /**
   * Số mục ĐÃ quá hạn — badge của mục menu Sắp hết hạn. Đọc `summary` của đúng lượt tính mà
   * màn hình dùng, nên badge và màn không bao giờ nói hai con số. Shell hỏi định kỳ ở mọi màn,
   * nên route này không được gia hạn idle của phiên (NFR-01).
   */
  @Roles('sa', 'admin', 'member')
  @NoIdleTouch()
  @Get('overdue/count')
  async overdueCount() {
    const { summary } = await this.expiry.list({ includeExpired: true, page: 1, limit: 1 });
    return { count: summary.expired };
  }

  @Roles('sa', 'admin', 'member')
  @Get('renewals')
  async renewals(@Query() query: RenewalsQueryDto) {
    if (query.from && query.to && query.to < query.from) {
      throw new BadRequestException({
        code: 'RANGE_INVALID',
        message: '"Đến ngày" không được trước "Từ ngày".',
      });
    }
    // Cột "Người" đọc họ tên (email vào tooltip) — tra một lượt qua users.api (AD-2).
    return withActorNames(await this.expiry.recentRenewals(query), (emails) =>
      this.users.namesByEmails(emails),
    );
  }

  // ───────────── Luật gửi báo cáo (FR-013) ─────────────

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
  testRule(
    @Param() params: RuleParamDto,
    @Body() body: TestRuleDto,
    @Req() req: AuthedRequest,
  ) {
    const user = req.user!;
    return this.digest.sendTest(
      user.email,
      params.id,
      body?.onlyMe ? { userId: user.id, email: user.email } : undefined,
    );
  }

  /** Nội dung thư của luật, xem ngay trong app — không gửi gì (EX-021). */
  @Roles('sa', 'admin', 'member')
  @Get('rules/:id/preview')
  previewRule(@Param() params: RuleParamDto) {
    return this.digest.preview(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Post('renew')
  @Audited('expiry.renewed', 'expiry', { writtenByService: true })
  async renew(@Body() body: RenewDto, @Req() req: AuthedRequest) {
    await this.expiry.renew(req.user!.email, body.kind, body.id, body.endDate, {
      contract: body.contract,
      cost: body.cost,
    });
    return { status: 'renewed' };
  }
}

/** Hậu tố tên file xuất theo ô số đang bật — người nhận biết ngay file là nhóm nào. */
const EXPORT_SUFFIX: Record<ExpiryFilterState, string> = {
  expired: 'qua-han',
  critical: 'gap',
  warning: 'sap-toi',
  autoRetire: 'cho-tu-thanh-ly',
};

/**
 * `?state=` chỉ nhận ba nhóm hạn của màn (xem `levelOf` trong `expiry.service.ts`) cộng nhóm
 * "chờ tự thanh lý"; giá trị lạ coi như không lọc.
 */
function isExpiryState(value: string | undefined): value is ExpiryFilterState {
  return (
    value === 'expired' || value === 'critical' || value === 'warning' || value === 'autoRetire'
  );
}

/** `?sort=` lạ thì về mặc định (ngày hết hạn) — cùng luật "giá trị lạ coi như không lọc". */
function sortOf(query: { sort?: string; dir?: string }): { sort?: ExpirySort; dir?: 'asc' | 'desc' } {
  const sort = (EXPIRY_SORTS as readonly string[]).includes(query.sort ?? '')
    ? (query.sort as ExpirySort)
    : undefined;
  return { sort, dir: query.dir === 'desc' ? 'desc' : 'asc' };
}
