import { defineConfig, devices } from '@playwright/test';
import { APP_TIMEZONE } from './app-timezone';

/**
 * E2E chạy trên STACK THẬT (docker compose), không mock API — DoD story.
 * Cert dev tự ký nên bỏ qua lỗi HTTPS.
 */
const BASE_URL = process.env.IMS_BASE_URL ?? 'https://ims.pmh.com.vn';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './global-setup.ts',
  // Trả `login.rate_limit_per_ip` về giá trị gốc — bộ test nới nó lên 500 để chạy được.
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    /**
     * Xem tận mắt: IMS_SLOW_MO=300 npx playwright test --headed
     * Mặc định 0 — CI và lượt chạy thường không bị chậm đi chút nào.
     */
    launchOptions: { slowMo: Number(process.env.IMS_SLOW_MO ?? 0) },
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'vi-VN',
    /*
     * Ghim đồng hồ của TRÌNH DUYỆT. Đọc từ `../app-timezone` chứ không gõ lại chuỗi: cùng
     * múi giờ ấy còn phải dùng ở `tests/helpers.ts` để dựng ngày fixture, và hai đồng hồ đó
     * lệch nhau thì fixture nói "còn 10 ngày" còn huy hiệu đọc "còn 9 ngày" — đã xảy ra thật
     * ngày 24/09, đỏ đúng 7 tiếng mỗi ngày.
     */
    timezoneId: APP_TIMEZONE,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      // Spec *.mobile.spec.ts chỉ chạy ở project 390px.
      testIgnore: /.*\.mobile\.spec\.ts/,
    },
    {
      // UX-DR2: mọi màn ĐỌC phải dùng được ở 390px.
      name: 'mobile-390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
      testMatch: /.*\.mobile\.spec\.ts/,
    },
  ],
});
