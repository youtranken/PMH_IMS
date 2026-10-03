import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { validationException } from './common/validation-messages';
import { json, type Express, type NextFunction, type Request, type Response } from 'express';
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
   * Đây là đường duy nhất đưa IP client xuống tới `audit_log.ip`. Thiếu nó thì cột đó NULL trên
   * 100% số dòng: `AuditWriterService` không có cách nào khác để biết IP, còn luồn tham số qua ~15 chữ ký thì chỗ gọi thứ 63 sẽ quên trong im lặng. Xem
   * `common/request-context.ts` để biết vì sao chọn ngữ cảnh ẩn cho ĐÚNG thứ này.
   *
   * `setupApp` được cả `main.ts` lẫn test e2e gọi (AD-15), nên không có đường nào bỏ sót nó.
   */
  app.use((req: Request, _res: Response, next: NextFunction) =>
    runWithRequestContext({ ip: clientIp(req) }, next),
  );

  /*
   * Body JSON mặc định của Nest trần 100 KB — vừa cho mọi form, quá nhỏ cho một bản vẽ draw.io
   * vài trăm hình. Nới RIÊNG route lưu phiên bản bản vẽ, không nới toàn cục (kể cả các route khác
   * của module sơ đồ): một trần lớn cho mọi route là mời gửi body khổng lồ vào những cửa chưa từng
   * cần. 12 MB = trần trên của `diagram.xml_max_kb` + `diagram.svg_max_kb` (4 MB mỗi thứ) cộng phần
   * JSON phình ra khi thoát dấu nháy; cổng kiểm của server vẫn chặn theo tham số đang đặt. Đăng ký
   * ở đây chạy TRƯỚC parser mặc định (Nest gắn nó lúc `listen`), và parser mặc định bỏ qua body
   * đã đọc.
   *
   * Bọc trong một hàm tên khác: Nest thấy trong stack đã có layer tên `jsonParser` (tên hàm
   * `json()` trả về) thì KHÔNG gắn parser mặc định nữa, và mọi route khác mất body JSON.
   */
  const diagramJson = json({ limit: '12mb' });
  app.use(/^\/api\/v1\/diagrams\/[^/]+\/versions$/, function diagramVersionBody(req: Request, res: Response, next: NextFunction) {
    diagramJson(req, res, next);
  });

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
      stopAtFirstError: true,
      /*
       * MẶC ĐỊNH ĐÓNG cho câu chữ.
       *
       * Không thể trông vào việc "DTO tự khai message": đo ra 434 validator mà chỉ 80 cái khai
       * `message`, nên thiếu dòng này thì ~354 cái còn lại nhả nguyên câu tiếng Anh của
       * class-validator ra màn hình người dùng.
       *
       * Đi qua `messagesOf` thì mọi validator — kể cả cái viết năm sau, kể cả cái người viết
       * quên `message` — đều ra tiếng Việt. DTO nào có câu riêng thì câu đó vẫn THẮNG.
       *
       * Giữ NGUYÊN hình dạng lỗi cũ (`BadRequestException(string[])`) để
       * `GlobalExceptionFilter` nối bằng '; ' và gắn `code: 'BAD_REQUEST'` y như trước —
       * đây là bản vá câu chữ, không phải dịp đổi hợp đồng API. Ngoại lệ duy nhất: ô chữ tự
       * do trông như mật khẩu (`@NoSecretText`) mang mã `NOTE_LOOKS_LIKE_SECRET`.
       */
      exceptionFactory: validationException,
    }),
  );

  // NFR-04: response của API không được nằm lại trong cache trung gian.
  // Endpoint trả secret còn đặt no-store riêng, nhưng mặc định đã là no-store.
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
}
