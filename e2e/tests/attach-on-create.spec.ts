import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  devicesPageButton,
  firstLogin,
  ispProviderId,
  resetDevices,
  resetIsp,
  resetSoftware,
  resetUsers,
  uniqueStamp,
} from './helpers';

/**
 * Đính kèm giấy tờ NGAY TRONG form thêm mới (khối dùng chung `ui/attachment-draft.tsx`).
 *
 * Hóa đơn, biên bản, bản scan hợp đồng nằm sẵn trên tay đúng lúc người ta gõ hồ sơ mới, nên
 * không bắt họ đợi tới trang chi tiết. Ba màn thêm mới (thiết bị, phần mềm, đường truyền) dùng
 * CHUNG một khối, nên ba bài dưới đây đi cùng một đường:
 * chọn file lúc điền form → lưu → mở tab Giấy tờ của hồ sơ vừa tạo và thấy file ở đó.
 */
test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetSoftware();
  resetIsp();
});

/** PDF nhỏ nhất còn hợp lệ về magic-byte (%PDF) — server soi ruột chứ không tin đuôi file. */
function writePdf(name: string): string {
  const path = join(tmpdir(), name);
  writeFileSync(path, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n');
  return path;
}

/** PNG 1x1 — nhánh "hoặc hình ảnh nếu cần" của yêu cầu, đi qua đúng whitelist magic-byte. */
function writePng(name: string): string {
  const path = join(tmpdir(), name);
  writeFileSync(
    path,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  return path;
}

const picker = (page: Page) => page.getByLabel('Chọn file để đính kèm');

/**
 * Điền phần bắt buộc của form "Thêm phần mềm".
 *
 * Chọn kỳ hạn VĨNH VIỄN để khỏi phải đi qua widget lịch: license thuê bao bắt buộc có ngày
 * hết hạn, mà cái lịch không phải thứ mấy bài này đi kiểm — chúng kiểm khối giấy tờ.
 */
async function fillSoftwareBasics(page: Page, code: string, name: string) {
  const form = page.getByRole('dialog');
  await form.getByRole('textbox', { name: 'Mã hồ sơ' }).fill(code);
  await form.getByRole('textbox', { name: 'Tên hồ sơ' }).fill(name);
  await form.getByRole('radio', { name: 'Vĩnh viễn', exact: true }).check();
  return form;
}

test.describe('Đính kèm giấy tờ ngay lúc thêm mới', () => {
  test('thiết bị: chọn hóa đơn + ảnh máy trong form Thêm thiết bị, lưu xong thấy ở tab Giấy tờ', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SW-E2E-ATT-${stamp}`;

    await page.goto('/devices');
    await devicesPageButton(page, 'Thêm thiết bị').click();

    const form = page.getByRole('dialog');
    await form.getByLabel('Mã thiết bị').fill(code);
    await form.getByLabel('Tên thiết bị').fill('Switch có hồ sơ đính kèm');
    await form.getByRole('button', { name: 'Loại' }).click();
    await page.getByRole('option', { name: 'Switch', exact: true }).click();

    // Hai file, hai loại: giấy tờ (pdf) và hình ảnh (png) — đúng như yêu cầu của màn.
    await picker(page).setInputFiles(writePdf(`hoa-don-${stamp}.pdf`));
    await picker(page).setInputFiles(writePng(`anh-may-${stamp}.png`));
    await expect(form.getByText(`hoa-don-${stamp}.pdf`)).toBeVisible();
    await expect(form.getByText(`anh-may-${stamp}.png`)).toBeVisible();

    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText('Đã đính kèm 2 giấy tờ.')).toBeVisible();

    await page.getByRole('row', { name: new RegExp(code) }).getByRole('link').first().click();
    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    await expect(page.getByRole('row', { name: new RegExp(`hoa-don-${stamp}`) })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(`anh-may-${stamp}`) })).toBeVisible();
  });

  test('phần mềm: chọn hợp đồng trong form Thêm phần mềm, lưu xong thấy ở tab Giấy tờ', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-ATT-${stamp}`;

    await page.goto('/software');
    await page.getByRole('button', { name: 'Thêm phần mềm' }).first().click();

    const form = await fillSoftwareBasics(page, code, 'Office 365 có hợp đồng');
    await picker(page).setInputFiles(writePdf(`hop-dong-${stamp}.pdf`));

    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText('Đã đính kèm 1 giấy tờ.')).toBeVisible();

    await page.getByRole('row', { name: new RegExp(code) }).getByRole('link').first().click();
    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    await expect(page.getByRole('row', { name: new RegExp(`hop-dong-${stamp}`) })).toBeVisible();

    // Tải về được là bằng chứng file thật sự nằm trên volume, không chỉ có dòng trong bảng.
    const download = await Promise.all([
      page.waitForEvent('download'),
      page
        .getByRole('row', { name: new RegExp(`hop-dong-${stamp}`) })
        .getByRole('button', { name: 'Tải về' })
        .click(),
    ]).then(([event]) => event);
    expect(download.suggestedFilename()).toBe(`hop-dong-${stamp}.pdf`);
  });

  test('đường truyền: chọn bản scan hợp đồng trong form Thêm đường truyền', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `ISP-E2E-ATT-${stamp}`;
    await ispProviderId(page, 'FPT Telecom E2E');

    await page.goto('/isp-lines');
    await page.getByRole('button', { name: 'Thêm đường truyền' }).first().click();

    const form = page.getByRole('dialog');
    await form.getByLabel('Mã đường').fill(code);
    await form.getByRole('button', { name: 'Nhà mạng', exact: true }).click();
    await page.getByRole('option', { name: 'FPT Telecom E2E', exact: true }).click();
    await picker(page).setInputFiles(writePdf(`scan-hd-${stamp}.pdf`));

    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText('Đã đính kèm 1 giấy tờ.')).toBeVisible();

    await page.getByRole('row', { name: new RegExp(code) }).getByRole('link').first().click();
    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    await expect(page.getByRole('row', { name: new RegExp(`scan-hd-${stamp}`) })).toBeVisible();
  });

  test('đường hỏng: bỏ file ra khỏi danh sách thì hồ sơ lưu xong KHÔNG có giấy tờ nào', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-BO-${stamp}`;

    await page.goto('/software');
    await page.getByRole('button', { name: 'Thêm phần mềm' }).first().click();

    const form = await fillSoftwareBasics(page, code, 'Hồ sơ đổi ý');
    await picker(page).setInputFiles(writePdf(`nham-${stamp}.pdf`));
    await form.getByRole('button', { name: `Bỏ "nham-${stamp}.pdf" khỏi danh sách sẽ đính kèm` }).click();
    await expect(form.getByText(`nham-${stamp}.pdf`)).toHaveCount(0);

    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText('Đã lưu hồ sơ.')).toBeVisible();

    await page.getByRole('row', { name: new RegExp(code) }).getByRole('link').first().click();
    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    await expect(page.getByText('Chưa có giấy tờ nào.')).toBeVisible();
  });

  test('đường hỏng: file giả mạo đuôi .pdf bị từ chối, hồ sơ VẪN được lưu', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-BAD-${stamp}`;

    // Đặt tên .pdf nhưng ruột là HTML. Hồ sơ đã ghi xuống DB trước khi file bay lên, nên
    // KHÔNG được cuốn theo: báo riêng chuyện file hỏng, đừng nói "lưu thất bại".
    const fake = join(tmpdir(), `gia-mao-${stamp}.pdf`);
    writeFileSync(fake, '<html><script>alert(1)</script></html>');

    await page.goto('/software');
    await page.getByRole('button', { name: 'Thêm phần mềm' }).first().click();
    const form = await fillSoftwareBasics(page, code, 'Hồ sơ kèm file lạ');
    await picker(page).setInputFiles(fake);
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();

    await expect(page.getByText(/Định dạng không được hỗ trợ/)).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
  });
});

test.describe('Giấy tờ của hồ sơ phần mềm', () => {
  test('đính kèm thẳng ở tab Giấy tờ của trang chi tiết rồi xóa đi', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    const created = await page.request.post('/api/v1/software', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      // SSL bắt buộc có hạn (luật `requiresEndDate`) — thiếu là 400 chứ không phải lỗi màn.
      data: {
        code: `SSL-E2E-${stamp}`,
        name: 'Chứng chỉ có giấy tờ',
        kind: 'ssl',
        endDate: '2028-12-31',
      },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    await page.goto(`/software/${id}`);
    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    await expect(page.getByText('Chưa có giấy tờ nào.')).toBeVisible();

    await picker(page).setInputFiles(writePdf(`chung-thu-${stamp}.pdf`));
    await expect(page.getByRole('row', { name: new RegExp(`chung-thu-${stamp}`) })).toBeVisible();
  });
});
