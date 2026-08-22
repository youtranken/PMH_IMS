import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

/**
 * Cấu hình dùng chung cho app HTTP — gọi từ main.ts VÀ từ test e2e,
 * để test chạy đúng bộ middleware như production (AD-15).
 */
export function setupApp(app: INestApplication): void {
  // Sau nginx: cần trust proxy để req.ip và secure cookie hoạt động đúng (NFR-04).
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', 1);

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
