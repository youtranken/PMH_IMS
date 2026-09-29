import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  Validate,
} from 'class-validator';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { sendXlsx } from '../../common/excel/xlsx-http';
import { RealDateOrEmpty } from '../../common/real-date';
import { parsePageQuery } from '../../common/pagination';
import { parseSortQuery } from '../../common/sorting';
import { dateTimeInTz } from '../../common/today';
import { Audited } from '../audit/audited.decorator';
import { SystemConfigService } from '../config-sys/system-config.service';
import { USER_SORT_DEFAULT, USER_SORT_KEYS, type UserListFilters } from '../users/users.api';
import { ACCOUNT_STATUS_ACTION, AccountsService } from './accounts.service';
import { Roles } from './roles.decorator';
import type { AuthedRequest, UserRole } from './types';
import { NoStepUp, RequiresStepUp } from './step-up.decorator';

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
  @Validate(RealDateOrEmpty, { message: 'Ngày sinh phải là một ngày có thật, dạng YYYY-MM-DD.' })
  birthDate?: string;
}

class CreateUserDto extends ContactDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email!: string;

  @IsString()
  @Length(2, 120, { message: 'Họ tên từ 2 đến 120 ký tự.' })
  fullName!: string;

  @IsIn(['sa', 'admin', 'member'], { message: 'Vai trò phải là Super Admin, Quản trị hoặc Thành viên.' })
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

  /** Lý do khóa / vô hiệu hóa — ghi vào nhật ký, không bắt buộc với "Mở khóa"/"Bật lại". */
  @IsOptional()
  @IsString()
  @Length(0, 500, { message: 'Lý do tối đa 500 ký tự.' })
  reason?: string;
}

class RoleDto {
  @IsIn(['sa', 'admin', 'member'], { message: 'Vai trò phải là Super Admin, Quản trị hoặc Thành viên.' })
  role!: UserRole;
}

type ListQuery = {
  page?: string;
  limit?: string;
  search?: string;
  sort?: string;
  dir?: string;
  role?: string;
  status?: string;
  totp?: string;
};

/**
 * Bộ lọc màn Tài khoản. Giá trị lạ thì 400 chứ không lặng lẽ bỏ: "lọc theo vai `superadmin`"
 * mà ra cả bảng là đọc nhầm thành "ai cũng là SA".
 */
function listFilters(query: ListQuery): UserListFilters {
  const pick = <T extends string>(value: string | undefined, allowed: readonly T[], field: string) => {
    if (!value) return undefined;
    if (!(allowed as readonly string[]).includes(value)) {
      throw new BadRequestException({ code: 'BAD_FILTER', message: `Bộ lọc ${field} không hợp lệ.` });
    }
    return value as T;
  };
  return {
    role: pick(query.role, ['sa', 'admin', 'member'] as const, 'vai trò'),
    status: pick(query.status, ['active', 'locked', 'disabled'] as const, 'trạng thái'),
    totp: pick(query.totp, ['none', 'enrolled'] as const, '2 lớp'),
  };
}

const ROLE_LABEL: Record<UserRole, string> = { sa: 'Super Admin', admin: 'Quản trị', member: 'Thành viên' };
const STATUS_LABEL: Record<'active' | 'locked' | 'disabled', string> = {
  active: 'Đang hoạt động',
  locked: 'Đang khóa',
  disabled: 'Đã vô hiệu hóa',
};

/** Trần số dòng một file xuất — danh sách nhân sự IT, vài trăm người là cùng. */
const EXPORT_LIMIT = 5000;

class TotpRequiredDto {
  @IsBoolean()
  required!: boolean;
}

class KillAllSessionsDto {
  @IsOptional()
  @IsBoolean()
  includeCurrent?: boolean;
}

/**
 * Quản trị tài khoản — CHỈ SA. Mọi route ghi có @Audited (AD-9).
 * Không có endpoint xóa user: nghiệp vụ chỉ khóa/vô hiệu hóa (convention "Xóa").
 */
@NoStepUp()
@Controller('api/v1/accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly excel: ExcelExportService,
    private readonly config: SystemConfigService,
  ) {}

  @Roles('sa')
  @Get()
  list(@Query() query: ListQuery) {
    return this.accounts.list(
      parsePageQuery(query),
      query.search,
      parseSortQuery(query, USER_SORT_KEYS, USER_SORT_DEFAULT),
      listFilters(query),
    );
  }

  /**
   * Danh sách tài khoản ra Excel THEO BỘ LỌC đang xem (kiểm toán định kỳ: ai, vai gì, cài 2
   * lớp chưa, đăng nhập lần cuối khi nào). `@Audited` như mọi đường xuất (FR-028): "ai kéo danh
   * sách nhân sự ra file" là câu phải trả lời được. Chỉ SA — cùng quyền với màn.
   */
  @Roles('sa')
  @Audited('accounts.exported', 'user')
  @Get('export')
  async export(@Query() query: ListQuery, @Res() res: Response) {
    const page = await this.accounts.list(
      { page: 1, limit: EXPORT_LIMIT },
      query.search,
      parseSortQuery(query, USER_SORT_KEYS, USER_SORT_DEFAULT),
      listFilters(query),
    );
    const tz = await this.config.getString('appTimezone');
    const buffer = await this.excel.build({
      sheetName: 'Người dùng IMS',
      columns: [
        { header: 'Họ tên', width: 28, value: (r) => r.fullName },
        { header: 'Email', width: 32, value: (r) => r.email },
        { header: 'Số điện thoại', width: 16, value: (r) => r.phone ?? '' },
        { header: 'Mã nhân viên', width: 14, value: (r) => r.employeeCode ?? '' },
        { header: 'Vai trò', width: 14, value: (r) => ROLE_LABEL[r.role] },
        { header: 'Trạng thái', width: 16, value: (r) => STATUS_LABEL[r.status] },
        {
          header: 'Xác thực 2 lớp',
          width: 16,
          value: (r) => (r.totpEnrolledAt ? 'Đã cài' : r.totpLoginRequired ? 'Chưa cài (bắt buộc)' : 'Chưa cài'),
        },
        { header: 'Đăng nhập gần nhất', width: 20, value: (r) => dateTimeInTz(r.lastLoginAt, tz) },
        { header: 'Ngày tạo', width: 20, value: (r) => dateTimeInTz(r.createdAt, tz) },
      ],
      rows: page.items,
    });
    sendXlsx(res, buffer, 'tai-khoan.xlsx');
  }

  @Roles('sa')
  /*
   * Cửa NẶNG NHẤT của cả bề mặt này: response trả thẳng `temporaryPassword`, nên một tài
   * khoản tạo ra ở đây là một tài khoản đăng nhập được ngay. Ghép với `POST /auth/totp/enroll`
   * (trả secret base32 nguyên văn) thì một phiên SA bị chiếm tự dựng được đường vào két mà
   * không cần yếu tố thứ hai của nạn nhân. Xem chuỗi sáu bước ở `step-up.guard.ts`.
   */
  @RequiresStepUp()
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
  // Khoá/vô hiệu hoá người khác — kể cả SA khác. Đường phá hoại thẳng, và `assertNotLastSa`
  // là thứ duy nhất đứng giữa nó với việc khoá cả công ty ra ngoài.
  @RequiresStepUp()
  @Patch(':id/status')
  @Audited(Object.values(ACCOUNT_STATUS_ACTION), 'user', { writtenByService: true })
  async setStatus(
    @Param('id') id: string,
    @Body() dto: StatusDto,
    @Req() req: AuthedRequest,
  ) {
    await this.accounts.setStatus(actor(req), id, dto.status, dto.reason);
    return { status: dto.status };
  }

  @Roles('sa')
  // Nâng một người lên SA/Quản trị là cấp quyền đọc mọi két — nặng ngang tạo tài khoản mới.
  @RequiresStepUp()
  @Patch(':id/role')
  @Audited('account.role.changed', 'user', { writtenByService: true })
  async setRole(@Param('id') id: string, @Body() dto: RoleDto, @Req() req: AuthedRequest) {
    await this.accounts.setRole(actor(req), id, dto.role);
    return { role: dto.role };
  }

  @Roles('sa')
  // Trả `temporaryPassword` trong response — đường chiếm tài khoản người khác ngắn nhất.
  @RequiresStepUp()
  @Post(':id/reset-password')
  @Audited('account.password.reset', 'user', { writtenByService: true })
  resetPassword(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.accounts.resetPassword(actor(req), id);
  }

  @Roles('sa')
  // XOÁ yếu tố thứ hai của một người khác. Nếu chính cửa này không đòi yếu tố thứ hai thì
  // toàn bộ 2FA của hệ thống chỉ mạnh bằng một cái cookie.
  @RequiresStepUp()
  @Post(':id/reset-totp')
  @Audited('account.mfa.reset', 'user', { writtenByService: true })
  async resetTotp(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.accounts.resetTotp(actor(req), id);
    return { status: 'reset' };
  }

  @Roles('sa')
  // TẮT bắt buộc 2FA lúc đăng nhập cho một tài khoản. Cùng lý do với `reset-totp`.
  @RequiresStepUp()
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

  /**
   * Tạm chặn theo từng IP (giãn chậm khi gõ sai) — chỉ đọc. Gỡ vẫn là "Gỡ tạm chặn" qua
   * `:id/status` (có step-up, có ghi vết): một nút xoá từng IP là thêm một cửa hạ rào thứ hai.
   */
  @Roles('sa')
  @Get(':id/lockouts')
  listLockouts(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.accounts.listLockouts(id);
  }

  @Roles('sa')
  @Get(':id/sessions')
  async listSessions(@Param('id') id: string, @Req() req: AuthedRequest) {
    // Đánh dấu phiên của CHÍNH SA đang xem — mở hộp phiên của mình thì biết dòng nào là máy này.
    const sessions = await this.accounts.listSessions(id);
    return sessions.map((session) => ({
      ...session,
      current: session.id === req.user?.sessionId,
    }));
  }

  @Roles('sa')
  // Khác `sessions/:sessionId/kill`: một lần bấm đá văng một người khỏi MỌI máy, kể cả chính SA
  // nếu chọn — phạm vi rộng như khóa tài khoản nên cũng đòi step-up.
  @RequiresStepUp()
  @Post(':id/sessions/kill-all')
  @Audited('session.killed_all', 'user', { writtenByService: true })
  async killAllSessions(
    @Param('id') id: string,
    @Body() dto: KillAllSessionsDto,
    @Req() req: AuthedRequest,
  ) {
    const killed = await this.accounts.killAllSessions(actor(req), id, {
      currentSessionId: req.user?.sessionId,
      includeCurrent: dto.includeCurrent === true,
    });
    return { killed };
  }

  @Roles('sa')
  /*
   * CỐ Ý không đòi step-up, và đây là một đánh đổi có chủ đích chứ không phải bỏ sót.
   *
   * Đây là nút dùng trong lúc SỰ CỐ: thấy một phiên lạ thì phải giết được NGAY. Bắt gõ mã 6
   * số đúng lúc đó là dựng một khúc chờ vào đường phản ứng, để đổi lấy rất ít — cửa này không
   * đọc được gì và không cấp được gì, hậu quả xấu nhất là làm phiền một người phải đăng nhập
   * lại. Đường phá hoại rộng hơn (`:id/status`) thì đã có step-up.
   */
  @NoStepUp()
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
