import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigThrottle } from '../../common/config-throttle';
import { clientIp } from '../../common/client-ip';
import { Audited } from '../audit/audited.decorator';
import { SystemConfigService } from '../config-sys/system-config.service';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  LoginDto,
  TotpEnrollStartDto,
  TotpReEnrollConfirmDto,
  TotpReEnrollStartDto,
  TotpTokenDto,
} from './auth.dto';
import { clearSessionCookie, setSessionCookie } from './cookie';
import { LoginRateGuard } from './login-rate.guard';
import { Public } from './public.decorator';
import { Roles } from './roles.decorator';
import { SessionService } from './session.service';
import { AllowPasswordPending } from './password-pending.decorator';
import { AllowTotpPending } from './totp-pending.decorator';
import type { AuthedRequest } from './types';
import { NoStepUp, RequiresStepUp } from './step-up.decorator';

const ALL_ROLES = ['sa', 'admin', 'member'] as const;

@NoStepUp()
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
    setSessionCookie(res, outcome.session.token);
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
   * Trần `rate.totp_per_minute` (10/phút) — CÙNG khoá với `POST /auth/step-up`, vì cùng một lý do:
   * mã TOTP chỉ có một triệu khả năng, còn trần chung 300/phút là quá rộng cho một ô 6 số.
   * Đường này kết thúc bằng `completeTotpWithin` (đóng dấu `stepped_up_at`) nên đoán trúng ở
   * đây là được cấp một phiên ĐÃ MỞ KÉT — nó là cửa két thứ hai, phải canh ngang cửa thứ nhất.
   */
  @ConfigThrottle('rateTotpPerMinute')
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
    setSessionCookie(res, result.session.token);
    return {
      status: 'authenticated',
      csrfToken: result.session.csrfToken,
      mustChangePassword: result.mustChangePassword,
    };
  }

  /**
   * A-02: cửa này TRẢ RA secret base32 nguyên văn, nên nó là cửa quyết định ai giữ chìa khóa
   * thứ hai của tài khoản về sau — không phải một cửa đọc. Phải chứng minh lại mình là ai.
   *
   * ===== VÌ SAO KHÔNG CÓ `@Throttle` RIÊNG Ở ĐÂY =====
   *
   * Bản đầu đặt trần 10 lượt/phút theo USER, cùng con số với `step-up`. Lượt chạy E2E đầy đủ
   * bác bỏ nó trong mười ba bài: cửa này KHÔNG chỉ là cửa nhận mật khẩu — nó còn là bước bắt
   * buộc của luồng đăng nhập lần đầu, và luồng đó gọi nó một lần mỗi lần đăng nhập. Trần theo
   * phút vì thế chặn đúng đường ĐÚNG trước khi chặn được đường sai.
   *
   * Và nó cũng là hàng rào sai loại: trần theo phút cho kẻ tấn công thử lại mãi, chỉ chậm
   * hơn. Hàng rào thật nằm ở service — sai đủ `secret.stepup_max_failures` lần thì THU HỒI
   * PHIÊN, chung bộ đếm với cửa két. Cookie trộm được chết sau năm lần, và muốn cookie mới
   * thì phải có mật khẩu.
   */
  @AllowTotpPending()
  @Roles(...ALL_ROLES)
  @AllowPasswordPending()
  @Post('totp/enroll')
  @HttpCode(200)
  @Audited('auth.totp.enroll.start', 'user', { writtenByService: true })
  async startEnroll(@Body() dto: TotpEnrollStartDto, @Req() req: AuthedRequest) {
    const session = await this.requireSession(req);
    const { secret, qrDataUrl, otpauthUrl } = await this.auth.startTotpEnrollment(
      session,
      dto.currentPassword,
    );
    // Secret hiện một lần lúc cài đặt; response không được cache (app.setup đặt no-store).
    return { secret, qrDataUrl, otpauthUrl };
  }

  @AllowTotpPending()
  @Roles(...ALL_ROLES)
  @AllowPasswordPending()
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
    // Chỉ khi phiên được cấp lại (regenerate sau khi qua 2 lớp) mới có token mới cho cookie.
    if (result.newToken) setSessionCookie(res, result.newToken);
    return { status: 'enrolled', csrfToken: result.session.csrfToken };
  }

  /**
   * Cài lại 2 lớp trên điện thoại mới khi ĐANG có 2 lớp (Q-14). `@RequiresStepUp()` ở route VÀ
   * kiểm lại trong service: route là lớp chặn chung, service là lớp không thể quên — thay yếu tố
   * thứ hai là thao tác chiếm tài khoản nếu lọt, nên không để nó phụ thuộc vào một dòng decorator.
   */
  @RequiresStepUp()
  @Roles(...ALL_ROLES)
  @Post('totp/re-enroll')
  @HttpCode(200)
  @Audited('auth.totp.reenroll.start', 'user', { writtenByService: true })
  async startReEnroll(@Body() dto: TotpReEnrollStartDto, @Req() req: AuthedRequest) {
    const session = await this.requireSession(req);
    return this.auth.startTotpReEnrollment(session, dto.currentPassword);
  }

  /**
   * Không đòi step-up lần nữa: vé chỉ sinh ra sau step-up + mật khẩu và gắn chặt với phiên này.
   * Đòi lại thì người đang mất vài phút cài ứng dụng trên máy mới bị hỏi mã của máy CŨ giữa chừng.
   */
  @ConfigThrottle('rateTotpPerMinute')
  @Roles(...ALL_ROLES)
  @Post('totp/re-enroll/confirm')
  @HttpCode(200)
  @Audited('auth.totp.reenroll.done', 'user', { writtenByService: true })
  async confirmReEnroll(@Body() dto: TotpReEnrollConfirmDto, @Req() req: AuthedRequest) {
    const session = await this.requireSession(req);
    const result = await this.auth.confirmTotpReEnrollment(session, dto.ticket, dto.token);
    return { status: 're-enrolled', revokedSessions: result.revokedSessions };
  }

  /** Phiên đang mở của CHÍNH MÌNH — không nhận tham số người dùng nào, nên không hỏi được của ai khác. */
  @Roles(...ALL_ROLES)
  @Get('sessions')
  async mySessions(@Req() req: AuthedRequest) {
    const session = await this.requireSession(req);
    return this.auth.listOwnSessions(session);
  }

  @Roles(...ALL_ROLES)
  @Post('sessions/revoke-others')
  @HttpCode(200)
  @Audited('auth.session.revoked_others', 'user', { writtenByService: true })
  async revokeOtherSessions(@Req() req: AuthedRequest) {
    const session = await this.requireSession(req);
    const revokedSessions = await this.auth.revokeOwnOtherSessions(session);
    return { status: 'revoked', revokedSessions };
  }

  @Roles(...ALL_ROLES)
  @Post('sessions/:id/revoke')
  @HttpCode(200)
  @Audited('auth.session.revoked_self', 'session', { writtenByService: true })
  async revokeSession(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthedRequest,
  ) {
    const session = await this.requireSession(req);
    await this.auth.revokeOwnSession(session, id);
    return { status: 'revoked' };
  }

  /**
   * Câu chỉ đường cho người quên mật khẩu / mất mã 2 lớp (Q-14) — đọc được khi CHƯA đăng nhập.
   * Chỉ trả đúng một khoá: mở cả `system_config` cho người lạ là lộ ngưỡng khoá, ân hạn két…
   */
  @Public()
  @Get('support-contact')
  async supportContact() {
    return { contact: await this.config.getString('authSupportContact') };
  }

  /**
   * FR-022: step-up để xem bí mật — luôn bắt buộc, kể cả khi tắt TOTP lúc đăng nhập.
   *
   * Trần `rate.totp_per_minute` (10/phút) THEO USER (UserThrottlerGuard). Mã TOTP chỉ có một triệu khả năng và
   * đây là cửa duy nhất vào cả két: trần 300/phút chung là quá rộng cho một ô 6 số. Người
   * dùng thật gõ nhiều nhất vài lần — 10 đã là rộng rãi.
   */
  @ConfigThrottle('rateTotpPerMinute')
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
  @AllowPasswordPending()
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
  @AllowPasswordPending()
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
  @AllowPasswordPending()
  @Get('me')
  async me(@Req() req: AuthedRequest) {
    const user = req.user!;
    const session = await this.requireSession(req);
    // UI cần biết đã cài 2 lớp chưa để đưa về ĐÚNG bước còn thiếu (enroll hay nhập mã).
    const enrolledAt = await this.auth.totpEnrolledAt(user.id);
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
      totpEnrolled: enrolledAt !== null,
      // Màn Hồ sơ hiện "Đã bật từ …" — cùng lượt đọc với cờ trên, không thêm query.
      totpEnrolledAt: enrolledAt,
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
