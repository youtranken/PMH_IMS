import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsString, Length } from 'class-validator';
import { parsePageQuery } from '../../common/pagination';
import { Audited } from '../audit/audited.decorator';
import { AccountsService } from './accounts.service';
import { Roles } from './roles.decorator';
import type { AuthedRequest, UserRole } from './types';

class CreateUserDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email!: string;

  @IsString()
  @Length(2, 120, { message: 'Họ tên từ 2 đến 120 ký tự.' })
  fullName!: string;

  @IsIn(['sa', 'admin', 'member'], { message: 'Vai trò phải là sa, admin hoặc member.' })
  role!: UserRole;

  @IsBoolean()
  totpLoginRequired: boolean = true;
}

class StatusDto {
  @IsIn(['active', 'locked', 'disabled'], { message: 'Trạng thái không hợp lệ.' })
  status!: 'active' | 'locked' | 'disabled';
}

class TotpRequiredDto {
  @IsBoolean()
  required!: boolean;
}

/**
 * Quản trị tài khoản — CHỈ SA (story 1.4). Mọi route ghi có @Audited (AD-9).
 * Không có endpoint xóa user: nghiệp vụ chỉ khóa/vô hiệu hóa (convention "Xóa").
 */
@Controller('api/v1/accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Roles('sa')
  @Get()
  list(@Query() query: { page?: string; limit?: string }) {
    return this.accounts.list(parsePageQuery(query));
  }

  @Roles('sa')
  @Post()
  @Audited('account.created', 'user')
  create(@Body() dto: CreateUserDto, @Req() req: AuthedRequest) {
    return this.accounts.create(actor(req), dto);
  }

  @Roles('sa')
  @Patch(':id/status')
  @Audited('account.status.changed', 'user')
  async setStatus(
    @Param('id') id: string,
    @Body() dto: StatusDto,
    @Req() req: AuthedRequest,
  ) {
    await this.accounts.setStatus(actor(req), id, dto.status);
    return { status: dto.status };
  }

  @Roles('sa')
  @Post(':id/reset-password')
  @Audited('account.password.reset', 'user')
  resetPassword(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.accounts.resetPassword(actor(req), id);
  }

  @Roles('sa')
  @Post(':id/reset-totp')
  @Audited('account.mfa.reset', 'user')
  async resetTotp(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.accounts.resetTotp(actor(req), id);
    return { status: 'reset' };
  }

  @Roles('sa')
  @Patch(':id/totp-login-required')
  @Audited('account.totp_login_required.changed', 'user')
  async setTotpRequired(
    @Param('id') id: string,
    @Body() dto: TotpRequiredDto,
    @Req() req: AuthedRequest,
  ) {
    await this.accounts.setTotpLoginRequired(actor(req), id, dto.required);
    return { required: dto.required };
  }

  @Roles('sa')
  @Get(':id/sessions')
  listSessions(@Param('id') id: string) {
    return this.accounts.listSessions(id);
  }

  @Roles('sa')
  @Post('sessions/:sessionId/kill')
  @Audited('session.killed', 'session')
  async killSession(@Param('sessionId') sessionId: string, @Req() req: AuthedRequest) {
    await this.accounts.killSession(actor(req), sessionId);
    return { status: 'killed' };
  }
}

function actor(req: AuthedRequest) {
  return { id: req.user!.id, email: req.user!.email };
}
