import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Audited } from '../audit/audited.decorator';
import { SystemConfigService } from '../config-sys/system-config.service';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, TotpTokenDto } from './auth.dto';
import { clearSessionCookie, setSessionCookie } from './cookie';
import { LoginRateGuard } from './login-rate.guard';
import { Public } from './public.decorator';
import { Roles } from './roles.decorator';
import { SessionService } from './session.service';
import { AllowTotpPending } from './totp-pending.decorator';
import type { AuthedRequest } from './types';

const ALL_ROLES = ['sa', 'admin', 'member'] as const;

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly config: SystemConfigService,
  ) {}

  /**
   * Bước 1: mật khẩu. Rate-limit theo IP (NFR-01) — ngưỡng đọc từ `system_config`
   * khóa `login.rate_limit_per_ip` qua LoginRateGuard, KHÔNG viết cứng ở đây (AD-11).
   */
  @Public()
  @UseGuards(LoginRateGuard)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const outcome = await this.auth.login(dto.email, dto.password, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
    setSessionCookie(res, outcome.session.id);
    return {
      status: outcome.status,
      csrfToken: outcome.session.csrfToken,
      mustChangePassword:
        outcome.status === 'authenticated' ? outcome.mustChangePassword : false,
    };
  }

  /**
   * Bước 2: mã TOTP. Phiên chờ được thay bằng phiên mới (regenerate id).
   *
   * Trần 10 lần/phút — CÙNG con số với `POST /auth/step-up` ngay dưới, và vì cùng một lý do:
   * mã TOTP chỉ có một triệu khả năng, còn trần chung 300/phút là quá rộng cho một ô 6 số.
   * Đường này kết thúc bằng `completeTotpWithin` (đóng dấu `stepped_up_at`) nên đoán trúng ở
   * đây là được cấp một phiên ĐÃ MỞ KÉT — nó là cửa két thứ hai, phải canh ngang cửa thứ nhất.
   * Trước 07/09 route này không có gì cả (rà soát 07/09, finding #2).
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AllowTotpPending()
  @Roles(...ALL_ROLES)
  @Post('login/totp')
  @HttpCode(200)
  async loginTotp(
    @Body() dto: TotpTokenDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.requireSession(req);
    const result = await this.auth.verifyLoginTotp(session, dto.token, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
    setSessionCookie(res, result.session.id);
    return {
      status: 'authenticated',
      csrfToken: result.session.csrfToken,
      mustChangePassword: result.mustChangePassword,
    };
  }

  @AllowTotpPending()
  @Roles(...ALL_ROLES)
  @Post('totp/enroll')
  @HttpCode(200)
  @Audited('auth.totp.enroll.start', 'user', { writtenByService: true })
  async startEnroll(@Req() req: AuthedRequest) {
    const user = req.user!;
    const { secret, qrDataUrl } = await this.auth.startTotpEnrollment(user.id);
    // Secret hiện một lần lúc cài đặt; response không được cache (app.setup đặt no-store).
    return { secret, qrDataUrl };
  }

  @AllowTotpPending()
  @Roles(...ALL_ROLES)
  @Post('totp/enroll/confirm')
  @HttpCode(200)
  @Audited('auth.totp.enroll.done', 'user', { writtenByService: true })
  async confirmEnroll(
    @Body() dto: TotpTokenDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.requireSession(req);
    const result = await this.auth.confirmTotpEnrollment(session, dto.token, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
    // Phiên có thể đã được cấp lại (regenerate sau khi qua 2 lớp) → cập nhật cookie.
    setSessionCookie(res, result.session.id);
    return { status: 'enrolled', csrfToken: result.session.csrfToken };
  }

  /**
   * FR-022: step-up để xem bí mật — luôn bắt buộc, kể cả khi tắt TOTP lúc đăng nhập.
   *
   * Trần 10 lần/phút THEO USER (UserThrottlerGuard). Mã TOTP chỉ có một triệu khả năng và
   * đây là cửa duy nhất vào cả két: trần 300/phút chung là quá rộng cho một ô 6 số. Người
   * dùng thật gõ nhiều nhất vài lần — 10 đã là rộng rãi.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Roles(...ALL_ROLES)
  @Post('step-up')
  @HttpCode(200)
  async stepUp(@Body() dto: TotpTokenDto, @Req() req: AuthedRequest) {
    const session = await this.requireSession(req);
    await this.auth.stepUp(session, dto.token);
    const graceMinutes = await this.config.getNumber('secretStepUpGraceMinutes');
    return { status: 'stepped-up', graceMinutes };
  }

  @Roles(...ALL_ROLES)
  @Post('change-password')
  @HttpCode(200)
  @Audited('auth.password.changed', 'user', { writtenByService: true })
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: AuthedRequest) {
    const session = await this.requireSession(req);
    await this.auth.changePassword(session, dto.currentPassword, dto.newPassword);
    return { status: 'changed' };
  }

  @AllowTotpPending()
  @Roles(...ALL_ROLES)
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const session = await this.requireSession(req);
    await this.auth.logout(session, req.user!.email);
    clearSessionCookie(res);
    return { status: 'logged-out' };
  }

  /** Thông tin phiên hiện tại — UI dùng để dựng shell, biết vai và trạng thái step-up. */
  @AllowTotpPending()
  @Roles(...ALL_ROLES)
  @Get('me')
  async me(@Req() req: AuthedRequest) {
    const user = req.user!;
    const session = await this.requireSession(req);
    // UI cần biết đã cài 2 lớp chưa để đưa về ĐÚNG bước còn thiếu (enroll hay nhập mã).
    const enrolled = await this.auth.isTotpEnrolled(user.id);
    const [graceMinutes, revealSeconds] = await Promise.all([
      this.config.getNumber('secretStepUpGraceMinutes'),
      this.config.getNumber('secretRevealSeconds'),
    ]);
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      totpPending: session.totpPending,
      totpEnrolled: enrolled,
      steppedUpAt: session.steppedUpAt,
      csrfToken: session.csrfToken,
      config: { stepUpGraceMinutes: graceMinutes, secretRevealSeconds: revealSeconds },
    };
  }

  private async requireSession(req: AuthedRequest) {
    const session = await this.sessions.find(req.user!.sessionId);
    if (!session) {
      throw new UnauthorizedException({
        code: 'SESSION_MISSING',
        message: 'Phiên không còn hợp lệ. Đăng nhập lại.',
      });
    }
    return session;
  }
}

/**
 * IP thật của client — đọc `req.ip`, KHÔNG bao giờ đọc `X-Forwarded-For` thô.
 *
 * VÌ SAO. `web/proxy-api-headers.conf:5` dùng `$proxy_add_x_forwarded_for`, tức nginx **NỐI
 * THÊM** vào giá trị client gửi lên chứ không ghi đè. Header tới đây là
 * `<client tự khai>, <IP thật>`. Bản trước lấy phần tử TRÁI NHẤT — tức lấy đúng thứ client
 * tự điền vào.
 *
 * Hai hậu quả, cái đầu nặng hơn nhiều:
 *
 * 1. `auth.service.ts` băm thiết bị = `sha256(userAgent | maskIp(ip))` giữ `/24`. Kẻ đã có
 *    mật khẩu chỉ cần gửi kèm `X-Forwarded-For: 192.168.1.77` và một User-Agent phổ thông là
 *    băm trùng thiết bị đã biết của nạn nhân → `rememberWithin` trả `isNew = false` → KHÔNG
 *    có email "đăng nhập từ thiết bị mới", không dòng `auth.device.new`. Đó là cái chuông duy
 *    nhất nạn nhân được nghe. IMS chạy LAN nên dải /24 đoán được và tập User-Agent rất hẹp.
 * 2. Mọi `audit_log.detail.ip` và `sessions.ip` mang giá trị do nghi phạm tự chọn. NFR-03 hỏi
 *    "từ đâu" thì câu trả lời là thứ nghi phạm điền vào.
 *
 * `req.ip` thì AN TOÀN: `app.setup.ts:13` đặt `trust proxy = 1`, nên Express bỏ đúng một hop
 * tin cậy ĐẾM TỪ PHẢI và trả về phần tử nginx đã nối — không phải phần client tự khai.
 * `LoginRateGuard:75` vốn đã dùng `request.ip`, nên đây cũng là gom hai khái niệm "IP client"
 * trong repo về một. Muốn chắc hơn nữa thì có `X-Real-IP` (nginx GHI ĐÈ bằng `$remote_addr`,
 * không nối, nên không giả được) — giữ lại đây như đường dự phòng nếu sau này bỏ trust proxy.
 */
export function clientIp(req: AuthedRequest): string | null {
  return req.ip ?? null;
}
