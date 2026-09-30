import { applyDecorators } from '@nestjs/common';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export const PHONE_MESSAGE = 'Số điện thoại chỉ gồm chữ số, dấu + ở đầu và dấu cách.';

/*
 * Q-18: chỉ chữ số, một dấu `+` ở đầu, và dấu cách để người gõ chia nhóm cho dễ đọc. Lưu thì
 * bỏ dấu cách — cùng một số viết hai kiểu ("0912 345 678" và "0912345678") phải ra MỘT giá
 * trị, không thì tìm kiếm và link `tel:` lệch nhau. Chuỗi rỗng = xóa giá trị, nên hợp lệ.
 */
const STORED_PHONE = /^(\+?\d+)?$/;

function stripSpaces(text: string): string {
  return text.replace(/\s+/g, '');
}

/**
 * Chuẩn hóa một số điện thoại gõ tay hoặc đọc từ Excel. Trả MỘT hình dạng: `value` là giá trị
 * để lưu (null khi không hợp lệ), `error` là câu báo cho người dùng.
 */
export function normalizePhone(raw: string): { value: string | null; error: string | null } {
  const value = stripSpaces(raw);
  return STORED_PHONE.test(value) ? { value, error: null } : { value: null, error: PHONE_MESSAGE };
}

function stripPhoneSpaces({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? stripSpaces(value) : value;
}

/**
 * Ô số điện thoại trong DTO. Bỏ dấu cách TRƯỚC khi kiểm, nên `maxLength` là độ dài đã lưu —
 * người gõ "0912 345 678" không bị trừ chỗ vì mấy dấu cách sẽ không vào DB. Dùng kèm
 * `@IsOptional()` khi ô không bắt buộc.
 */
export function IsPhone(maxLength: number): PropertyDecorator {
  return applyDecorators(
    Transform(stripPhoneSpaces),
    IsString({ message: PHONE_MESSAGE }),
    Length(0, maxLength, { message: `Số điện thoại tối đa ${maxLength} ký tự.` }),
    Matches(STORED_PHONE, { message: PHONE_MESSAGE }),
  );
}

/**
 * Số điện thoại tách nhóm cho CHỮ server tự ghép (khu đường truyền trên trang thiết bị, …).
 * Cùng luật với `web/src/lib/phone-format.ts` — lưu vẫn là số liền; dạng không nhận ra chắc
 * chắn thì trả nguyên văn.
 */
function groupDigits(digits: string, sizes: number[]): string {
  const out: string[] = [];
  let at = 0;
  for (const size of sizes) {
    out.push(digits.slice(at, at + size));
    at += size;
  }
  return out.join(' ');
}

function formatNational(digits: string): string | null {
  if (/^1[89]00\d{4}$/.test(digits)) return groupDigits(digits, [4, 4]);
  if (/^1[89]00\d{6}$/.test(digits)) return groupDigits(digits, [4, 4, 2]);
  if (/^02\d{9}$/.test(digits)) return groupDigits(digits, [3, 4, 4]);
  if (/^0\d{9}$/.test(digits)) return groupDigits(digits, [4, 3, 3]);
  return null;
}

export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  if (compact.startsWith('+84')) {
    const national = formatNational(`0${compact.slice(3)}`);
    return national ? `+84 ${national.slice(1)}` : raw;
  }
  return formatNational(compact) ?? raw;
}
