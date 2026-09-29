import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  Validate,
} from 'class-validator';
import { RealDate } from '../../common/real-date';
import { Audited } from '../audit/audited.decorator';
import { parsePageQuery } from '../../common/pagination';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { SystemConfigService } from '../config-sys/system-config.service';
import { sendXlsx } from '../../common/excel/xlsx-http';
import { dateTimeInTz } from '../../common/today';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { BreakGlassService } from './break-glass.service';
import { SECRET_OWNER_TYPES, type SecretOwnerType } from './vault.service';
import { NoStepUp, RequiresStepUp } from '../auth/step-up.decorator';
import { NoIdleTouch } from '../auth/no-idle-touch.decorator';

/** Bộ lọc nhật ký mở két (VLT-019) — dùng chung cho màn và file xuất. */
class LogQueryDto {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;

  @IsOptional()
  @IsIn(['pending', 'approved', 'denied', 'cancelled', 'expired', 'revoked'])
  state?: string;

  @IsOptional() @IsString() @MaxLength(255) requester?: string;

  @IsOptional() @Validate(RealDate, { message: '"Từ ngày" phải là ngày có thật, dạng YYYY-MM-DD.' }) from?: string;
  @IsOptional() @Validate(RealDate, { message: '"Đến ngày" phải là ngày có thật, dạng YYYY-MM-DD.' }) to?: string;
}

function logFilters(query: LogQueryDto) {
  return { state: query.state, requester: query.requester, from: query.from, to: query.to };
}

class RequestDto {
  @IsIn([...SECRET_OWNER_TYPES], { message: 'Loại chủ thể không hợp lệ.' })
  ownerType!: SecretOwnerType;

  @IsUUID(undefined, { message: 'Mã chủ thể không hợp lệ.' })
  ownerId!: string;

  @IsString() @Length(5, 500) reason!: string;

  /**
   * Trần thật nằm ở `breakglass.max_grant_hours` (AD-11) và service KẸP theo nó. Chặn 168 ở
   * đây chỉ để một con số vô lý không đi xa hơn cửa vào — không phải để thay cho trần cấu hình.
   */
  @Min(1) @Max(168) @IsInt() hours!: number;
}

class DecisionDto {
  @IsOptional() @Min(1) @Max(168) @IsInt() hours?: number;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã yêu cầu không hợp lệ.' })
  id!: string;
}

/**
 * Break-glass (FR-023).
 *
 * Quyền ở đây cố ý KHÔNG đối xứng: ai cũng XIN được (kể cả Admin, dù họ hiếm khi cần), nhưng
 * chỉ SA/Admin mới QUYẾT. Người xin cũng tự hủy được yêu cầu của chính mình — việc đã xong
 * trước khi ai kịp duyệt là chuyện thường lúc 2 giờ sáng.
 */
@NoStepUp()
@Controller('api/v1/vault/break-glass')
export class BreakGlassController {
  constructor(
    private readonly breakGlass: BreakGlassService,
    private readonly excel: ExcelExportService,
    private readonly config: SystemConfigService,
  ) {}

  /** Yêu cầu của CHÍNH MÌNH — Member mở màn này để xem đã được duyệt chưa. */
  @Roles('sa', 'admin', 'member')
  @Get('mine')
  mine(@Req() req: AuthedRequest, @Query() query: { page?: string; limit?: string }) {
    return this.breakGlass.mine(actor(req), parsePageQuery(query));
  }

  /** Hàng chờ của người duyệt. */
  @Roles('sa', 'admin')
  @Get('pending')
  pending() {
    return this.breakGlass.pendingForApprovers();
  }

  /**
   * Số phiếu người đang hỏi duyệt được — badge trên menu, hỏi định kỳ. Chỉ một con số, không
   * tra tên hồ sơ: shell gọi nó ở mọi màn nên phải nhẹ.
   */
  @Roles('sa', 'admin')
  @NoIdleTouch()
  @Get('pending/count')
  async pendingCount(@Req() req: AuthedRequest) {
    return { count: await this.breakGlass.pendingCountFor(actor(req)) };
  }

  /** Quyền đang có hiệu lực — nhóm ghim đầu tab Nhật ký, kèm nút Thu hồi sớm (VLT-020). */
  @Roles('sa', 'admin')
  @Get('active')
  active() {
    return this.breakGlass.activeGrants();
  }

  /** FR-025: nhật ký đầy đủ — ai xin, lý do, ai duyệt, hết hạn lúc nào. Dashboard đọc. */
  @Roles('sa', 'admin')
  @Get('log')
  log(@Query() query: LogQueryDto) {
    return this.breakGlass.log(parsePageQuery(query), logFilters(query));
  }

  /**
   * FR-025 / AC 7.2: xuất nhật ký break-glass để nộp cho auditor.
   *
   * File này KHÔNG có cột nào chứa secret — chỉ ai xin, đối tượng nào, lý do, ai duyệt, hạn
   * bao lâu. FR-026 vẫn nguyên hiệu lực: không đường nào xuất được giá trị trong két, kể cả
   * đường đi vòng qua nhật ký (`vault-surface.spec.ts` khóa luật này lại).
   */
  @Roles('sa', 'admin')
  @Audited('break_glass.exported', 'approval')
  @Get('export.xlsx')
  async export(@Query() query: LogQueryDto, @Res() res: Response) {
    const rows = await this.breakGlass.logAll(logFilters(query));
    const tz = await this.config.getString('appTimezone');
    const buffer = await this.excel.build({
      sheetName: 'Nhật ký mở két',
      columns: [
        { header: 'Người xin', width: 28, value: (r) => r.requester },
        { header: 'Loại đối tượng', width: 18, value: (r) => SUBJECT_TYPE_LABEL[r.subjectType] ?? r.subjectType },
        { header: 'Mã đối tượng', width: 38, value: (r) => r.subjectId },
        { header: 'Lý do', width: 48, value: (r) => r.reason },
        /**
         * Trạng thái ĐỌC THEO ĐỒNG HỒ, không đọc thẳng cột `state` (AD-6).
         *
         * Grant đã quá hạn mà sweep chưa kịp đổi `state` thì cột này in "Đã duyệt" —
         * và đó chính là tờ giấy đem đi trình auditor. Màn duyệt xử cùng một cách; file
         * xuất phải khớp màn.
         */
        {
          header: 'Trạng thái',
          width: 16,
          value: (r) =>
            r.state === 'approved' && !r.active
              ? 'Đã duyệt · hết hiệu lực'
              : (BG_STATE_LABEL[r.state] ?? r.state),
        },
        { header: 'Người quyết', width: 28, value: (r) => r.decidedBy ?? '' },
        { header: 'Ghi chú quyết', width: 36, value: (r) => r.decisionNote ?? '' },
        /**
         * Ngày giờ ghi thành CHUỖI theo múi giờ ứng dụng, không đưa `Date` thô vào ô.
         *
         * ExcelJS quy `Date` về số serial theo giờ UTC. Một yêu cầu lúc 2 giờ sáng giờ VN
         * sẽ hiện là 19 giờ HÔM TRƯỚC trong file — lệch 7 tiếng, có khi lệch cả ngày, so
         * với chính màn hình vừa bấm xuất.
         */
        { header: 'Gửi lúc', width: 20, value: (r) => dateTimeInTz(r.createdAt, tz) },
        { header: 'Hết hạn', width: 20, value: (r) => dateTimeInTz(r.expiresAt, tz) },
      ],
      rows,
    });
    sendXlsx(res, buffer, 'nhat-ky-mo-ket.xlsx');
  }

  @Roles('sa', 'admin', 'member')
  @Post()
  @Audited('break_glass.requested', 'approval', { writtenByService: true })
  request(@Body() body: RequestDto, @Req() req: AuthedRequest) {
    // Phiên lấy từ guard, không từ body. Yêu cầu không gắn phiên; quyền gắn lúc xem lần đầu (Q-15).
    return this.breakGlass.request(
      { email: actor(req), sessionId: req.user!.sessionId },
      body,
    );
  }

  @Roles('sa', 'admin')
  // Duyệt = cấp quyền đọc két trong nhiều giờ. Đây là cửa CẤP QUYỀN, nặng ngang
  // `POST /vault/access`, nên nó đòi mã như mọi cửa cấp quyền khác.
  @RequiresStepUp()
  @Post(':id/approve')
  @Audited('break_glass.approved', 'approval', { writtenByService: true })
  approve(@Param() params: IdParamDto, @Body() body: DecisionDto, @Req() req: AuthedRequest) {
    return this.breakGlass.approve(actor(req), params.id, body);
  }

  @Roles('sa', 'admin')
  @Post(':id/deny')
  @Audited('break_glass.denied', 'approval', { writtenByService: true })
  deny(@Param() params: IdParamDto, @Body() body: DecisionDto, @Req() req: AuthedRequest) {
    return this.breakGlass.deny(actor(req), params.id, body.note);
  }

  /** Thu hồi sớm: người xin không còn trực nữa thì không phải chờ hết giờ. */
  @Roles('sa', 'admin')
  // Thu hồi một grant đang sống — phá hoại thẳng, cùng khuôn `DELETE /vault/secrets/:id`.
  @RequiresStepUp()
  @Post(':id/revoke')
  @Audited('break_glass.revoked', 'approval', { writtenByService: true })
  revoke(@Param() params: IdParamDto, @Body() body: DecisionDto, @Req() req: AuthedRequest) {
    return this.breakGlass.revoke(actor(req), params.id, body.note);
  }

  @Roles('sa', 'admin', 'member')
  @Post(':id/cancel')
  @Audited('break_glass.cancelled', 'approval', { writtenByService: true })
  cancel(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    return this.breakGlass.cancel(actor(req), params.id);
  }

  /**
   * Người xin tự trả quyền sớm (VLT-055). Không đòi mã 6 số: bỏ bớt quyền của chính mình không
   * mở thêm được gì. Service gác "chỉ grant của chính mình".
   */
  @Roles('sa', 'admin', 'member')
  @Post(':id/release')
  // Service ghi dòng `break_glass.revoked` với người làm là chính người xin — khai đúng tên đó.
  @Audited('break_glass.revoked', 'approval', { writtenByService: true })
  release(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    return this.breakGlass.release(actor(req), params.id);
  }

  /**
   * Một phiếu — đích của nút trong thư. Người duyệt đọc mọi phiếu, Member chỉ phiếu của mình
   * (service gác). Khai SAU cùng: `:id` đứng trước thì nuốt mất `mine`/`pending`/`log`.
   */
  @Roles('sa', 'admin', 'member')
  @Get(':id')
  detail(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    const role = req.user!.role;
    return this.breakGlass.detail(actor(req), role === 'sa' || role === 'admin', params.id);
  }
}

function actor(req: AuthedRequest): string {
  return req.user!.email;
}

/** Tên loại hồ sơ như menu gọi — ô Excel không in mã `service_account`. */
const SUBJECT_TYPE_LABEL: Record<string, string> = {
  device: 'Thiết bị',
  software: 'Phần mềm',
  service_account: 'Tài khoản dịch vụ',
  isp: 'Đường truyền',
};

const BG_STATE_LABEL: Record<string, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  denied: 'Đã từ chối',
  cancelled: 'Đã rút',
  expired: 'Hết hạn',
  revoked: 'Đã thu hồi',
};
