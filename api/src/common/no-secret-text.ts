import { registerDecorator, type ValidationArguments } from 'class-validator';
import { textLooksLikeSecret } from './note-secret';
import { FIELD_LABEL, NO_SECRET_TEXT_CONSTRAINT } from './validation-messages';

/**
 * Câu lỗi khi một ô chữ tự do ngoài két chứa chuỗi trông như mật khẩu (Q-19, SEC-21). Dùng
 * chung cho DTO và cửa nhập Excel: một luật, một câu.
 *
 * Câu KHÔNG nhắc lại đoạn chữ bị chặn — nhắc lại là chép bí mật sang body lỗi, log, màn hình.
 */
export function secretTextMessage(label: string): string {
  return (
    `${label} có một chuỗi trông như mật khẩu. Ô này không được mã hóa và còn đi vào lịch sử, ` +
    'file xuất — cất mật khẩu vào két của hồ sơ. Nếu đó là mã model hay tên gói, tách bằng dấu cách.'
  );
}

/**
 * Chặn ô chữ tự do (ghi chú, mô tả, lý do) chứa mật khẩu hoặc product key. Lỗi đi ra với mã
 * `NOTE_LOOKS_LIKE_SECRET` — xem `validationException`.
 *
 * `label` chỉ cần khi nhãn chung của tên trường (`FIELD_LABEL`) sai nghĩa ở DTO này, ví dụ
 * `address` của site là "Địa chỉ", không phải "Địa chỉ IP".
 */
export function NoSecretText(label?: string): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: NO_SECRET_TEXT_CONSTRAINT,
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate(value: unknown): boolean {
          return typeof value !== 'string' || !textLooksLikeSecret(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return secretTextMessage(label ?? FIELD_LABEL[args.property] ?? args.property);
        },
      },
    });
  };
}
