import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { Express, NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { clientIp } from './common/client-ip';
import { runWithRequestContext } from './common/request-context';

/**
 * Cấu hình dùng chung cho app HTTP — gọi từ main.ts VÀ từ test e2e,
 * để test chạy đúng bộ middleware như production (AD-15).
 */
export function setupApp(app: INestApplication): void {
  // Sau nginx: cần trust proxy để req.ip và secure cookie hoạt động đúng (NFR-04).
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', 1);

  /*
   * Ngữ cảnh request — phải đứng NGAY SAU `trust proxy` (nếu không `req.ip` còn là IP của
   * nginx) và TRƯỚC mọi thứ khác, để mọi handler phía sau đều nằm trong phạm vi.
   *
   * Đây là đường duy nhất đưa IP client xuống tới `audit_log.ip`. Trước 08/09 cột đó NULL trên
   * 100% số dòng suốt 9 epic (rà soát 07/09, #3): `AuditWriterService` không có cách nào biết
   * IP, còn luồn tham số qua ~15 chữ ký thì chỗ gọi thứ 63 sẽ quên trong im lặng. Xem
   * `common/request-context.ts` để biết vì sao chọn ngữ cảnh ẩn cho ĐÚNG thứ này.
   *
   * `setupApp` được cả `main.ts` lẫn test e2e gọi (AD-15), nên không có đường nào bỏ sót nó.
   */
  app.use((req: Request, _res: Response, next: NextFunction) =>
    runWithRequestContext({ ip: clientIp(req) }, next),
  );

  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // QR enroll TOTP là data: URI; ảnh đính kèm phục vụ từ chính origin.
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      // LAN-only HTTPS: bật HSTS ở nginx; ở đây tắt để dev http không kẹt.
      hsts: process.env.NODE_ENV === 'production',
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Message tiếng Việt do DTO khai; giữ nguyên shape lỗi của GlobalExceptionFilter.
      stopAtFirstError: true,
    }),
  );

  // NFR-04: response của API không được nằm lại trong cache trung gian.
  // Endpoint trả secret còn đặt no-store riêng, nhưng mặc định đã là no-store.
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
}
