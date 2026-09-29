import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email!: string;

  @IsString()
  @Length(1, 200, { message: 'Chưa nhập mật khẩu.' })
  password!: string;
}

export class TotpTokenDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Mã xác thực gồm đúng 6 chữ số.' })
  token!: string;
}

/**
 * A-02: cài yếu tố thứ hai là một hành động "sudo" — phải chứng minh lại mình là ai.
 *
 * `@IsOptional` chứ không bắt buộc, vì luồng đăng nhập bắt buộc cài 2 lớp được miễn (mật
 * khẩu vừa gõ xong vài giây trước). Ai được miễn là quyết định của `AuthService`, không
 * phải của DTO: nó cần biết tuổi phiên và cờ `totp_pending`, hai thứ DTO không thấy.
 */
export class TotpEnrollStartDto {
  /**
   * `@ValidateIf` CHỨ KHÔNG `@IsOptional`.
   *
   * `@IsOptional()` của class-validator bỏ qua mọi luật khi giá trị là `undefined` HOẶC
   * `null`. Nên `{"currentPassword": null}` qua được cửa, rồi tới service:
   *
   *     if (currentPassword === undefined) → REAUTH_REQUIRED
   *
   * `null !== undefined`, nên nó KHÔNG rơi vào nhánh "chưa chứng minh lại mình" mà rơi xuống
   * `passwords.verify(hash, null)` — tức nhánh SAI MẬT KHẨU. Người dùng tiêu một lượt đoán,
   * và một dòng `auth.totp.enroll.reauth_failed` vào sổ, cho một request chưa hề gửi mật khẩu.
   *
   * `@ValidateIf(… !== undefined)` chỉ miễn đúng ca VẮNG MẶT — thứ mà luồng đăng nhập bắt
   * buộc cài 2 lớp cần. Gửi `null` tường minh thì phải trượt ở cửa, không đi tiếp.
   *
   * Cùng hình dạng với `kind`/`licenseModel` bên software.
   */
  @ValidateIf((dto: TotpEnrollStartDto) => dto.currentPassword !== undefined)
  @IsString()
  @MinLength(1, { message: 'Chưa nhập mật khẩu hiện tại.' })
  @MaxLength(200, { message: 'Mật khẩu hiện tại quá dài (tối đa 200 ký tự).' })
  currentPassword?: string;
}

/** Cài lại 2 lớp khi đang có 2 lớp: mật khẩu hiện tại là BẮT BUỘC (không có ngoại lệ luồng đăng nhập). */
export class TotpReEnrollStartDto {
  @IsString()
  @MinLength(1, { message: 'Chưa nhập mật khẩu hiện tại.' })
  @MaxLength(200, { message: 'Mật khẩu hiện tại quá dài (tối đa 200 ký tự).' })
  currentPassword!: string;
}

export class TotpReEnrollConfirmDto extends TotpTokenDto {
  @IsString()
  @Length(1, 2000, { message: 'Thiếu vé cài lại — bấm Cài lại để bắt đầu lại.' })
  ticket!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'Chưa nhập mật khẩu hiện tại.' })
  @MaxLength(200, { message: 'Mật khẩu hiện tại quá dài (tối đa 200 ký tự).' })
  currentPassword!: string;

  @IsString()
  @Length(12, 200, { message: 'Mật khẩu mới phải dài tối thiểu 12 ký tự.' })
  newPassword!: string;
}
