import { SetMetadata } from '@nestjs/common';

/**
 * Trần theo phút của một route, đọc từ `system_config` thay vì số viết trong `@Throttle` (AD-11).
 *
 * `@Throttle({ default: { limit: 10 } })` là decorator TĨNH: con số nằm trong mã, đổi phải dựng
 * lại ảnh docker, và khoá cấu hình tương ứng (nếu có) chỉ để trưng bày. Route khai
 * `@ConfigThrottle('<tên khoá>')` thì `UserThrottlerGuard` hỏi số đó mỗi lượt (qua bộ nhớ đệm
 * 30 giây của `SystemConfigService`), vẫn đếm theo USER như mọi route khác.
 *
 * Tên khoá là chuỗi vì `src/common` không được biết `config-sys` (AD-2).
 * `config-throttle-surface.spec.ts` khẳng định mọi tên được dùng đều có thật trong `CONFIG_KEYS`.
 */
export const CONFIG_THROTTLE = 'ims:config-throttle';

export const ConfigThrottle = (configName: string) => SetMetadata(CONFIG_THROTTLE, configName);

/** Nguồn trần — AppModule nối nó vào `SystemConfigService` (`useExisting`). */
export const THROTTLE_LIMITS = Symbol('THROTTLE_LIMITS');

export interface ThrottleLimitSource {
  getNumber(name: string): Promise<number>;
}
