import { defineConfig, devices } from '@playwright/test';

/**
 * E2E chạy trên STACK THẬT (docker compose), không mock API — DoD story.
 * Cert dev tự ký nên bỏ qua lỗi HTTPS.
 */
const BASE_URL = process.env.IMS_BASE_URL ?? 'https://localhost';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './global-setup.ts',
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
    timezoneId: 'Asia/Ho_Chi_Minh',
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
