import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { parsePageQuery } from '../../common/pagination';
import { parseSortQuery } from '../../common/sorting';
import { Audited } from '../audit/audited.decorator';
import { USER_SORT_DEFAULT, USER_SORT_KEYS } from '../users/users.service';
import { AccountsService } from './accounts.service';
import { Roles } from './roles.decorator';
import type { AuthedRequest, UserRole } from './types';

/**
 * Ngày lịch CÓ THẬT ở dạng `YYYY-MM-DD`, hoặc chuỗi rỗng (= xoá giá trị).
 *
 * Dựng lại ngày từ ba mảnh rồi so ngược: `new Date('2026-02-31')` không ném mà tự trôi sang
 * 03/03, nên chỉ parse được thôi thì chưa chứng minh được ngày đó tồn tại.
 */
@ValidatorConstraint({ name: 'realDateOrEmpty' })
export class RealDateOrEmpty implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || value === '') return true;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }

  defaultMessage(): string {
    return 'Ngày sinh phải là một ngày có thật, dạng YYYY-MM-DD.';
  }
}

/**
 * SĐT và mã nhân viên (0031) — hai ô TÙY CHỌN, dùng chung cho cả tạo mới lẫn sửa hồ sơ.
 *
 * Không bắt buộc vì hàng chục tài khoản đã tạo từ trước không có sẵn hai giá trị này; bắt
 * buộc ngay là khóa luôn màn Sửa cho tới khi có người đi điền đủ cho mọi người.
 */
class ContactDto {
  @IsOptional()
  @IsString()
  @Length(0, 32, { message: 'Số điện thoại tối đa 32 ký tự.' })
  // Chỉ số, dấu cách, +, -, chấm và ngoặc — đủ cho mọi cách viết ("0912 345 678",
  // "+84 28 3822 1234", "(028) 3822-1234") mà vẫn chặn được người gõ nhầm cả một câu vào đây.
  @Matches(/^[0-9+\-.() ]*$/, { message: 'Số điện thoại chỉ gồm số và các ký tự + - . ( ).' })
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(0, 32, { message: 'Mã nhân viên tối đa 32 ký tự.' })
  employeeCode?: string;

  @IsOptional()
  @IsString()
  /*
   * Chuỗi rỗng phải LỌT qua (nghĩa là "xoá ngày sinh"), nên không dùng `@IsDateString` —
   * nó từ chối chuỗi rỗng và người dùng hết đường bỏ giá trị đã lỡ nhập.
   *
   * Nhưng riêng regex thì KHÔNG đủ: `2026-13-45` khớp đúng khuôn, đi thẳng vào cột `date`,
   * và Postgres ném 22008 → 500 trắng thay vì đúng câu tiếng Việt bên dưới. Nên kiểm cả
   * ngày có THẬT hay không.
   */
  @Validate(RealDateOrEmpty)
  birthDate?: string;
}

class CreateUserDto extends ContactDto {
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

class ProfileDto extends ContactDto {
  @IsString()
  @Length(2, 120, { message: 'Họ tên từ 2 đến 120 ký tự.' })
  fullName!: string;
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
  list(
    @Query()
    query: { page?: string; limit?: string; search?: string; sort?: string; dir?: string },
  ) {
    return this.accounts.list(
      parsePageQuery(query),
      query.search,
      parseSortQuery(query, USER_SORT_KEYS, USER_SORT_DEFAULT),
    );
  }

  @Roles('sa')
  @Post()
  @Audited('account.created', 'user', { writtenByService: true })
  create(@Body() dto: CreateUserDto, @Req() req: AuthedRequest) {
    return this.accounts.create(actor(req), dto);
  }

  /** Sửa hồ sơ: họ tên, SĐT, mã nhân viên. KHÔNG đổi email — email là danh tính đăng nhập. */
  @Roles('sa')
  @Patch(':id/profile')
  @Audited('account.profile.updated', 'user', { writtenByService: true })
  updateProfile(
    @Param('id') id: string,
    @Body() dto: ProfileDto,
    @Req() req: AuthedRequest,
  ) {
    return this.accounts.updateProfile(actor(req), id, dto);
  }

  @Roles('sa')
  @Patch(':id/status')
  @Audited('account.status.changed', 'user', { writtenByService: true })
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
  @Audited('account.password.reset', 'user', { writtenByService: true })
  resetPassword(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.accounts.resetPassword(actor(req), id);
  }

  @Roles('sa')
  @Post(':id/reset-totp')
  @Audited('account.mfa.reset', 'user', { writtenByService: true })
  async resetTotp(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.accounts.resetTotp(actor(req), id);
    return { status: 'reset' };
  }

  @Roles('sa')
  @Patch(':id/totp-login-required')
  @Audited('account.totp_login_required.changed', 'user', { writtenByService: true })
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
  @Audited('session.killed', 'session', { writtenByService: true })
  async killSession(@Param('sessionId') sessionId: string, @Req() req: AuthedRequest) {
    await this.accounts.killSession(actor(req), sessionId);
    return { status: 'killed' };
  }
}

function actor(req: AuthedRequest) {
  return { id: req.user!.id, email: req.user!.email };
}
