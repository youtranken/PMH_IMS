import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Audited } from '../audit/audited.decorator';
import { SystemConfigService } from '../config-sys/system-config.service';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, TotpTokenDto } from './auth.dto';
import { clearSessionCookie, setSessionCookie } from './cookie';
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
   * Bước 1: mật khẩu. Rate-limit theo IP (NFR-01) do ThrottlerGuard áp ở tầng app;
   * ở đây siết chặt hơn cho riêng endpoint đăng nhập.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
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

  /** Bước 2: mã TOTP. Phiên chờ được thay bằng phiên mới (regenerate id). */
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
  @Audited('auth.totp.enroll.start', 'user')
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
  @Audited('auth.totp.enroll.done', 'user')
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

  /** FR-022: step-up để xem bí mật — luôn bắt buộc, kể cả khi tắt TOTP lúc đăng nhập. */
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
  @Audited('auth.password.changed', 'user')
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

/** Sau nginx reverse proxy, IP thật nằm ở X-Forwarded-For (app.setup bật trust proxy). */
export function clientIp(req: AuthedRequest): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip ?? null;
}
