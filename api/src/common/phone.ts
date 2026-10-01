import { applyDecorators } from '@nestjs/common';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export const PHONE_MESSAGE =
  'Số điện thoại chỉ gồm chữ số, dấu + ở đầu, dấu cách và các dấu - . ( ).';

/*
 * Q-18: chữ số, một dấu `+` ở đầu, cộng các dấu trình bày người ta quen gõ (dấu cách, `-`, `.`,
 * `( )`). Lưu thì bỏ hết dấu trình bày — cùng một số viết nhiều kiểu ("(028) 3822-1234",
 * "028 3822 1234") phải ra MỘT giá trị, không thì tìm kiếm và link `tel:` lệch nhau. Chuẩn hoá
 * thay vì từ chối: hồ sơ cũ nhập kiểu đó phải lưu lại được khi form gửi lại số không đổi.
 * Chuỗi rỗng = xóa giá trị, nên hợp lệ.
 */
const STORED_PHONE = /^(\+?\d+)?$/;

function stripPresentation(text: string): string {
  return text.replace(/[\s.()-]+/g, '');
}

/**
 * Chuẩn hóa một số điện thoại gõ tay hoặc đọc từ Excel. Trả MỘT hình dạng: `value` là giá trị
 * để lưu (null khi không hợp lệ), `error` là câu báo cho người dùng.
 */
export function normalizePhone(raw: string): { value: string | null; error: string | null } {
  const value = stripPresentation(raw);
  return STORED_PHONE.test(value) ? { value, error: null } : { value: null, error: PHONE_MESSAGE };
}

function stripPhonePresentation({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? stripPresentation(value) : value;
}

/**
 * Ô số điện thoại trong DTO. Bỏ dấu trình bày TRƯỚC khi kiểm, nên `maxLength` là độ dài đã lưu
 * — người gõ "0912 345 678" không bị trừ chỗ vì mấy dấu cách sẽ không vào DB. Dùng kèm
 * `@IsOptional()` khi ô không bắt buộc.
 */
export function IsPhone(maxLength: number): PropertyDecorator {
  return applyDecorators(
    Transform(stripPhonePresentation),
    IsString({ message: PHONE_MESSAGE }),
    Length(0, maxLength, { message: `Số điện thoại tối đa ${maxLength} ký tự.` }),
    Matches(STORED_PHONE, { message: PHONE_MESSAGE }),
  );
}

/** Tách nhóm cho CHỮ server tự ghép — bản chép y hệt của web, xem `phone-format.ts`. */
export { formatPhone } from './phone-format';
