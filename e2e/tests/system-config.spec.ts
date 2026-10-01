import { expect, test } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  getConfig,
  resetUsers,
  SECOND_BROWSER,
  setConfig,
  sql,
  writeHeaders,
  openNavGroup,
} from './helpers';

/**
 * Màn Tham số hệ thống (Q-14): SA sửa `system_config` qua giao diện thay cho psql trên prod.
 * Mọi bài trả khoá về giá trị cũ sau khi chạy — bảng này dùng chung cho cả bộ E2E.
 */
const GRACE = 'software.auto_retire_grace_days';
let graceBefore = '';

test.beforeEach(() => {
  resetUsers();
  graceBefore = getConfig(GRACE);
});
test.afterEach(() => {
  if (graceBefore) setConfig(GRACE, graceBefore);
});

test.describe('Tham số hệ thống', () => {
  test('SA sửa theo nhóm: diff Trước → Sau, lưu, "sửa lần cuối bởi", nhật ký ghi trước/sau', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await openNavGroup(page);
    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Tham số hệ thống', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tham số hệ thống' })).toBeVisible();

    await page.getByRole('navigation', { name: 'Nhóm tham số' }).getByRole('button', { name: 'Phần mềm' }).click();
    const input = page.getByLabel('Ân hạn trước khi tự thanh lý phần mềm');
    const next = String(Number(graceBefore) === 45 ? 46 : 45);
    await input.fill(next);
    await expect(page.getByText('Có 1 thay đổi chưa lưu')).toBeVisible();
    await page.getByRole('button', { name: 'Lưu nhóm này' }).click();

    const review = page.getByRole('dialog', { name: 'Xác nhận đổi tham số' });
    await expect(review.getByText(`${graceBefore} ngày`)).toBeVisible();
    await expect(review.getByText(`${next} ngày`)).toBeVisible();
    await review.getByRole('button', { name: 'Lưu thay đổi' }).click();

    await expect(page.getByText('Đã lưu 1 tham số.')).toBeVisible();
    await expect(page.getByText(new RegExp(`Sửa lần cuối bởi ${E2E_SA.email}`)).first()).toBeVisible();
    expect(getConfig(GRACE)).toBe(next);
    expect(
      sql(
        `SELECT count(*) FROM audit_log WHERE action = 'system_config.updated' AND object_id = '${GRACE}' AND actor = '${E2E_SA.email}'`,
      ),
    ).not.toBe('0');
  });

  test('giá trị nguy hiểm có cảnh báo vàng; ngoài khoảng thì báo lỗi và không cho lưu', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/settings?group=auth');
    const rate = page.getByRole('textbox', { name: 'Số lượt đăng nhập tối đa mỗi IP' });
    await rate.fill('150');
    await expect(page.getByText(/là nới rất rộng/)).toBeVisible();
    await rate.fill('3');
    await expect(page.getByText('Phải từ 5 đến 1000.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lưu nhóm này' })).toBeDisabled();
    await page.getByRole('button', { name: 'Bỏ thay đổi' }).click();

    await page.goto('/admin/settings?group=software');
    await page.getByLabel('Ân hạn trước khi tự thanh lý phần mềm').fill('0');
    await expect(page.getByText('Đặt 0 là tắt hẳn chức năng này.')).toBeVisible();
  });

  /* Q-21: đổi nhóm khi còn thay đổi chưa lưu thì hỏi; "Ở lại" giữ nguyên, "Bỏ thay đổi" mới sang. */
  test('đổi nhóm khi chưa lưu: hỏi Lưu / Bỏ thay đổi / Ở lại, không ghi gì', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/settings?group=auth');
    const rate = page.getByRole('textbox', { name: 'Số lượt đăng nhập tối đa mỗi IP' });
    const before = await rate.inputValue();
    await rate.fill(before === '30' ? '31' : '30');
    const nav = page.getByRole('navigation', { name: 'Nhóm tham số' });
    await nav.getByRole('button', { name: 'Phần mềm' }).click();

    const ask = page.getByRole('dialog', { name: 'Chưa lưu thay đổi' });
    await expect(ask).toBeVisible();
    await ask.getByTestId('dialog-footer').getByRole('button', { name: 'Ở lại' }).click();
    await expect(ask).toBeHidden();
    await expect(rate).not.toHaveValue(before);

    await nav.getByRole('button', { name: 'Phần mềm' }).click();
    await ask.getByRole('button', { name: 'Bỏ thay đổi' }).click();
    await expect(page.getByLabel('Ân hạn trước khi tự thanh lý phần mềm')).toBeVisible();
    await nav.getByRole('button', { name: 'Đăng nhập & bảo mật' }).click();
    await expect(rate).toHaveValue(before);
  });

  test('TẤN CÔNG: Thành viên gọi thẳng API → 403; SA gửi khoá ngoài danh sách / ngoài khoảng → 400', async ({
    page,
    browser,
  }) => {
    await firstLogin(page, E2E_SA);
    const headers = await writeHeaders(page);
    const outside = await page.request.patch('/api/v1/admin/settings', {
      headers,
      data: { changes: [{ key: 'app.timezone', value: 'UTC' }] },
    });
    expect(outside.status()).toBe(400);
    const outOfRange = await page.request.patch('/api/v1/admin/settings', {
      headers,
      data: { changes: [{ key: 'session.absolute_hours', value: 0 }] },
    });
    expect(outOfRange.status()).toBe(400);
    expect(getConfig('app.timezone')).not.toBe('UTC');

    const memberCtx = await browser.newContext(SECOND_BROWSER);
    try {
      const memberPage = await memberCtx.newPage();
      await firstLogin(memberPage, E2E_MEMBER);
      const read = await memberPage.request.get('/api/v1/admin/settings');
      expect(read.status()).toBe(403);
      const write = await memberPage.request.patch('/api/v1/admin/settings', {
        headers: await writeHeaders(memberPage),
        data: { changes: [{ key: GRACE, value: 5 }] },
      });
      expect(write.status()).toBe(403);
      expect(getConfig(GRACE)).toBe(graceBefore);
    } finally {
      await memberCtx.close();
    }
  });
});
