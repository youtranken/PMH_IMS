import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { redactForLog } from './log-redact';

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  /** Field nghiệp vụ bổ sung (vd rowNumber/rows của import 2.9) — pass-through. */
  [extra: string]: unknown;
}

/**
 * Convention toàn hệ: mọi lỗi REST trả { statusCode, code, message }.
 * Story 3.x sẽ mở rộng mapper 409 (SLOT_TAKEN / ASSET_UNAVAILABLE / STALE_VERSION).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      /*
       * QUA `redactForLog`, KHÔNG in thẳng `.stack` (rà soát 07/09, mục 6 "Bảo mật").
       *
       * `DrizzleQueryError` nhét cả mảng THAM SỐ ĐÃ BIND vào message của nó, và `.stack` chứa
       * message nguyên văn ở dòng đầu. Nên một câu INSERT vào `users` mà hỏng sẽ in hash
       * Argon2, ciphertext TOTP secret, email, họ tên, số điện thoại ra `docker logs` — ra
       * ngoài đúng ranh giới PII mà NFR-04/AD-4 dựng quanh DB, với vòng đời và danh sách người
       * đọc hoàn toàn khác. Xem `log-redact.ts` để biết vì sao không thể vá bằng regex.
       */
      this.logger.error(redactForLog(exception));
    }
    // Response đã gửi (stream/write dở) → không thể đổi status; chỉ log, tránh
    // ERR_HTTP_HEADERS_SENT thứ cấp nuốt mất lỗi gốc.
    if (response.headersSent) {
      /*
       * NGOẠI LỆ CÓ KIỂM CỦA LUẬT `NO_RAW_ERROR_MESSAGE_IN_LOG` (11/09).
       *
       * Luật đó bắt `.message` trong dòng log vì `DrizzleQueryError.message` chở tham số đã
       * bind. Ở đây `body` KHÔNG phải lỗi gốc — nó là body đã đi qua `toBody`, mà hàm đó trả
       * đúng chuỗi `'Internal server error'` cho mọi lỗi không đoán trước, còn nhánh
       * `HttpException` thì `message` là câu do chính ta viết ra và sắp gửi cho client.
       *
       * Giữ `body.message` chứ không đổi sang `redactMessage(exception)`: dòng log này trả lời
       * câu "response nào đã bị nuốt", nên nó phải in đúng thứ lẽ ra client nhận được. Lỗi gốc
       * đã được ghi đầy đủ ở khối `>= 500` bên trên.
       */
      /* eslint-disable no-restricted-syntax -- `body` đã qua `toBody`, không phải lỗi gốc */
      this.logger.error(
        `Exception sau khi headers đã gửi (status ${body.statusCode}): ${body.message}`,
      );
      /* eslint-enable no-restricted-syntax */
      return;
    }
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const raw = exception.getResponse();
      if (typeof raw === 'string') {
        return { statusCode, code: this.defaultCode(statusCode), message: raw };
      }
      if (raw === null || typeof raw !== 'object') {
        // HttpException(null, ...) / payload số — không để filter tự ném TypeError
        return {
          statusCode,
          code: this.defaultCode(statusCode),
          message: exception.message,
        };
      }
      const obj = raw as Record<string, unknown>;
      const message = Array.isArray(obj.message)
        ? (obj.message as string[]).join('; ')
        : typeof obj.message === 'string'
          ? obj.message
          : exception.message;
      const code =
        typeof obj.code === 'string' ? obj.code : this.defaultCode(statusCode);
      // field nghiệp vụ bổ sung (rowNumber, rows… — import 2.9) đi kèm body,
      // KHÔNG ghi đè 3 field chuẩn
      const extras: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (!['statusCode', 'code', 'message', 'error'].includes(k)) {
          extras[k] = v;
        }
      }
      return { ...extras, statusCode, code, message };
    }
    // Lỗi không đoán trước: không lộ chi tiết nội bộ ra body.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };
  }

  private defaultCode(statusCode: number): string {
    return HttpStatus[statusCode] ?? `HTTP_${statusCode}`;
  }
}
