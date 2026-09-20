import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

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
  @IsOptional()
  @IsString()
  @Length(1, 200, { message: 'Chưa nhập mật khẩu hiện tại.' })
  currentPassword?: string;
}

export class ChangePasswordDto {
  @IsString()
  @Length(1, 200, { message: 'Chưa nhập mật khẩu hiện tại.' })
  currentPassword!: string;

  @IsString()
  @Length(12, 200, { message: 'Mật khẩu mới phải dài tối thiểu 12 ký tự.' })
  newPassword!: string;
}
