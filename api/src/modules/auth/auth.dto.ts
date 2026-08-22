import { IsEmail, IsString, Length, Matches } from 'class-validator';

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

export class ChangePasswordDto {
  @IsString()
  @Length(1, 200, { message: 'Chưa nhập mật khẩu hiện tại.' })
  currentPassword!: string;

  @IsString()
  @Length(12, 200, { message: 'Mật khẩu mới phải dài tối thiểu 12 ký tự.' })
  newPassword!: string;
}
