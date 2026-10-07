import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, fillLogin, fillOtp, firstLogin, NEW_PASSWORD, resetUsers } from './helpers';

/*
 * Thanh cuộn nháy (góp ý 07/10/2026). Hai lỗi chỉ thấy bằng mắt nên bài đo bằng số, từng khung hình:
 * - rê chuột qua menu: mục trượt 2px làm vùng cuộn của sidebar rộng hơn khung → thanh cuộn ngang;
 * - gõ lại mã 2 lớp sau một lượt sai trên màn thấp: dòng lỗi mất lúc kiểm rồi hiện lại, card co
 *   giãn một dòng → thanh cuộn của trang bật tắt.
 */

/** Ghi lại mọi giá trị khác nhau của `read()` qua từng khung hình trong `ms`. */
function watchFrames(page: Page, ms: number, read: 'docHeight' | 'navOverflowX'): Promise<string[]> {
  return page.evaluate(
    async ({ duration, what }) => {
      const seen = new Set<string>();
      const until = performance.now() + duration;
      while (performance.now() < until) {
        if (what === 'docHeight') {
          seen.add(String(document.documentElement.scrollHeight));
        } else {
          const nav = document.querySelector('nav[aria-label="Điều hướng chính"]');
          for (const el of [nav, ...Array.from(nav?.querySelectorAll('*') ?? [])]) {
            if (el instanceof HTMLElement && /(auto|scroll)/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth) {
              seen.add(`${el.scrollWidth}>${el.clientWidth}`);
            }
          }
        }
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return [...seen];
    },
    { duration: ms, what: read },
  );
}

test.beforeEach(() => {
  resetUsers();
});

test('rê chuột qua menu không làm sidebar hiện thanh cuộn ngang', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await firstLogin(page, E2E_SA);
  const links = page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link');
  const hovering = (async () => {
    const n = Math.min(await links.count(), 10);
    for (let i = 0; i < n; i += 1) await links.nth(i).hover();
  })();
  const overflow = await watchFrames(page, 2000, 'navOverflowX');
  await hovering;
  expect(overflow, 'vùng cuộn của sidebar không được rộng hơn khung ở bất kỳ khung hình nào').toEqual([]);
});

test('gõ lại mã 2 lớp sau lượt sai, màn thấp: trang giữ nguyên chiều cao (thanh cuộn không nháy)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await firstLogin(page, E2E_SA);
  await page.context().clearCookies();
  await page.setViewportSize({ width: 1280, height: 650 });
  await fillLogin(page, E2E_SA.email, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Xác thực 2 lớp' })).toBeVisible();
  const code = page.getByRole('group', { name: 'Mã xác thực' });
  await fillOtp(page, '000000');
  await expect(page.getByRole('alert')).toBeVisible();
  // Lượt thứ hai: từ lúc gõ tới lúc server từ chối, dòng lỗi cũ phải giữ chỗ.
  await expect(code.getByRole('textbox').first()).toBeEditable();
  const heights = watchFrames(page, 2500, 'docHeight');
  await fillOtp(page, '111111');
  expect(await heights, 'trang co giãn trong lúc kiểm mã = thanh cuộn nháy').toHaveLength(1);
  await expect(page.getByRole('alert')).toBeVisible();
});
