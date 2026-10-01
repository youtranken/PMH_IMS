import { BadRequestException, ValidationPipe, type Type } from '@nestjs/common';
import { validationException } from '../common/validation-messages';

/**
 * Chạy một DTO qua `ValidationPipe` với ĐÚNG cấu hình của `app.setup.ts` (kể cả
 * `exceptionFactory`), trả body lỗi như client nhận — hoặc `null` khi hợp lệ. Bài kiểm DTO
 * dựng pipe riêng thì kiểm một cấu hình không chạy ở đâu cả.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  stopAtFirstError: true,
  exceptionFactory: validationException,
});

export async function dtoErrorBody(
  metatype: Type<unknown>,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    await pipe.transform(payload, { type: 'body', metatype });
    return null;
  } catch (e) {
    if (!(e instanceof BadRequestException)) throw e;
    return e.getResponse() as Record<string, unknown>;
  }
}

/** Đoạn chữ có mật khẩu dùng chung cho các bảng kiểm `@NoSecretText` theo module. */
export const SECRET_TEXT_SAMPLE = 'mk tạm Pmh@Guest2026 nhớ đổi';
/** Đoạn chữ thường, có mã model + IP, phải qua mọi ô. */
export const PLAIN_TEXT_SAMPLE = 'Model WS-C2960X-48FPD-L, IP 10.0.0.1, HĐ HD-2026/PMH-01';
