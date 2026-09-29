import { ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';

/**
 * Ngày lịch CÓ THẬT ở dạng `YYYY-MM-DD`.
 *
 * Regex khuôn ngày thôi thì không đủ: `2026-02-30` khớp khuôn, đi thẳng vào cột `date` và
 * Postgres ném 22008 → 500 thay vì 400 có câu tiếng Việt. Dựng lại ngày từ ba mảnh rồi so
 * ngược, vì `new Date('2026-02-31')` không ném mà tự trôi sang 03/03.
 */
export function isRealDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Ô ngày TÙY CHỌN: chuỗi rỗng lọt qua (= xoá giá trị), nên không dùng `@IsDateString` — nó từ
 * chối chuỗi rỗng và người dùng hết đường bỏ giá trị đã lỡ nhập. Dùng kèm `@IsOptional()`.
 */
@ValidatorConstraint({ name: 'realDateOrEmpty' })
export class RealDateOrEmpty implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === '') return true;
    return typeof value === 'string' && isRealDateOnly(value);
  }

  defaultMessage(): string {
    return 'Ngày phải là một ngày có thật, dạng YYYY-MM-DD.';
  }
}

/** Ô ngày BẮT BUỘC (vd hạn mới khi gia hạn): chuỗi rỗng cũng bị từ chối. */
@ValidatorConstraint({ name: 'realDate' })
export class RealDate implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isRealDateOnly(value);
  }

  defaultMessage(): string {
    return 'Ngày phải là một ngày có thật, dạng YYYY-MM-DD.';
  }
}
