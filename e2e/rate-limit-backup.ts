import { fileURLToPath } from 'node:url';

/**
 * Nơi cất giá trị gốc của `login.rate_limit_per_ip` giữa `global-setup` và `global-teardown`.
 *
 * Phải là FILE chứ không phải biến: hai hook chạy ở hai tiến trình khác nhau của Playwright.
 *
 * Dùng `import.meta.url` chứ KHÔNG dùng `__dirname`: gói `e2e` khai `"type": "module"` nên
 * `__dirname` không tồn tại — và vì file này được `globalSetup` import, lỗi đó làm chết cả
 * lượt chạy trước khi có bài test nào bắt đầu.
 */
export const RATE_LIMIT_BACKUP_FILE = fileURLToPath(
  new URL('.rate-limit-original', import.meta.url),
);
