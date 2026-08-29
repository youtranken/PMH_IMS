import { join } from 'node:path';

/**
 * Nơi cất giá trị gốc của `login.rate_limit_per_ip` giữa `global-setup` và `global-teardown`.
 *
 * Phải là FILE chứ không phải biến: hai hook chạy ở hai tiến trình khác nhau của Playwright.
 */
export const RATE_LIMIT_BACKUP_FILE = join(__dirname, '.rate-limit-original');
