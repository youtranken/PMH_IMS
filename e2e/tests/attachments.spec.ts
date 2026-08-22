import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetDevices, resetUsers } from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetDevices();
});

/** PDF nhỏ nhất còn hợp lệ về magic-byte (%PDF) để test đường upload. */
function writePdf(name: string): string {
  const path = join(tmpdir(), name);
  writeFileSync(path, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n');
  return path;
}

async function createDevice(page: Page, code: string): Promise<string> {
  const csrf = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const type = catalog.deviceTypes.find((t) => t.name === 'Server')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': csrf, Origin: 'https://localhost' },
    data: { code, name: 'Máy chủ có giấy tờ', deviceTypeId: type.id },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

test.describe('Giấy tờ đính kèm thiết bị', () => {
  test('đường hạnh phúc: đính kèm → thấy trong danh sách → tải về → xóa', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceId = await createDevice(page, `SRV-E2E-${stamp}`);

    await page.goto(`/thiet-bi/${deviceId}`);
    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    await expect(page.getByText('Chưa có giấy tờ nào.')).toBeVisible();

    const pdf = writePdf(`hoa-don-${stamp}.pdf`);
    await page.getByLabel('Chọn file để đính kèm').setInputFiles(pdf);
    await page.getByRole('button', { name: 'Tải lên' }).click();

    const row = page.getByRole('row', { name: new RegExp(`hoa-don-${stamp}`) });
    await expect(row).toBeVisible();

    const download = await Promise.all([
      page.waitForEvent('download'),
      row.getByRole('button', { name: 'Tải về' }).click(),
    ]).then(([event]) => event);
    expect(download.suggestedFilename()).toBe(`hoa-don-${stamp}.pdf`);

    await row.getByRole('button', { name: 'Xóa' }).click();
    await page.getByRole('button', { name: 'Đồng ý' }).click();
    await expect(page.getByText('Chưa có giấy tờ nào.')).toBeVisible();
  });

  test('file lạ định dạng bị từ chối theo MAGIC-BYTE, không tin đuôi file', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceId = await createDevice(page, `SRV-BAD-${stamp}`);

    // Đặt tên .pdf nhưng ruột là HTML — đúng kiểu file dùng để chèn mã độc.
    const fake = join(tmpdir(), `gia-mao-${stamp}.pdf`);
    writeFileSync(fake, '<html><script>alert(1)</script></html>');

    await page.goto(`/thiet-bi/${deviceId}`);
    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    await page.getByLabel('Chọn file để đính kèm').setInputFiles(fake);
    await page.getByRole('button', { name: 'Tải lên' }).click();

    await expect(page.getByText(/Định dạng không được hỗ trợ/)).toBeVisible();
    await expect(page.getByText('Chưa có giấy tờ nào.')).toBeVisible();
  });

  test('file tải về LUÔN là attachment octet-stream — không mở inline trong trình duyệt', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceId = await createDevice(page, `SRV-HDR-${stamp}`);

    await page.goto(`/thiet-bi/${deviceId}`);
    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    await page.getByLabel('Chọn file để đính kèm').setInputFiles(writePdf(`bien-ban-${stamp}.pdf`));
    await page.getByRole('button', { name: 'Tải lên' }).click();
    await expect(page.getByRole('row', { name: new RegExp(`bien-ban-${stamp}`) })).toBeVisible();

    const files = await page.evaluate(async (id: string) => {
      const res = await fetch(`/api/v1/files?ownerType=device&ownerId=${id}`, {
        credentials: 'include',
      });
      return (await res.json()) as { id: string }[];
    }, deviceId);

    const response = await page.request.get(`/api/v1/files/${files[0].id}/download`);
    expect(response.status()).toBe(200);
    // Ba lớp chống render inline: kiểu nhị phân, buộc tải về, cấm đoán kiểu.
    expect(response.headers()['content-type']).toBe('application/octet-stream');
    expect(response.headers()['content-disposition']).toContain('attachment');
    // nginx (add_header) và helmet cùng đặt header này nên giá trị hợp lại là
    // "nosniff, nosniff" — hợp lệ theo HTTP, kiểm bằng contains thay vì so bằng.
    expect(response.headers()['x-content-type-options']).toContain('nosniff');
  });

  test('xóa rồi thì không tải về được nữa', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceId = await createDevice(page, `SRV-DEL-${stamp}`);

    await page.goto(`/thiet-bi/${deviceId}`);
    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    await page.getByLabel('Chọn file để đính kèm').setInputFiles(writePdf(`xoa-${stamp}.pdf`));
    await page.getByRole('button', { name: 'Tải lên' }).click();
    await expect(page.getByRole('row', { name: new RegExp(`xoa-${stamp}`) })).toBeVisible();

    const files = await page.evaluate(async (id: string) => {
      const res = await fetch(`/api/v1/files?ownerType=device&ownerId=${id}`, {
        credentials: 'include',
      });
      return (await res.json()) as { id: string }[];
    }, deviceId);
    const fileId = files[0].id;

    await page
      .getByRole('row', { name: new RegExp(`xoa-${stamp}`) })
      .getByRole('button', { name: 'Xóa' })
      .click();
    await page.getByRole('button', { name: 'Đồng ý' }).click();
    await expect(page.getByText('Chưa có giấy tờ nào.')).toBeVisible();

    const response = await page.request.get(`/api/v1/files/${fileId}/download`);
    expect(response.status()).toBe(404);
  });
});
