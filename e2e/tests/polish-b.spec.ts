import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import {
  E2E_MEMBER,
  E2E_SA,
  catalogItem,
  devicesPageButton,
  firstLogin,
  isoInDays,
  resetCatalog,
  resetDevices,
  resetDigestRules,
  resetSoftware,
  resetUsers,
  sql,
  searchAndWaitForFilter,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Đợt trau chuốt Q-15 (nhóm quản trị · khung app · sắp hết hạn · thanh lý): phần còn bỏ của
 * các mục "làm một phần". Mỗi khối một đường hạnh phúc + một đường hỏng.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetCatalog();
  resetSoftware();
  resetDigestRules();
});

async function createMember(page: Page): Promise<{ id: string; email: string; fullName: string }> {
  const stamp = uniqueStamp();
  const email = `e2e-tao-moi-${stamp}@pmh.com.vn`;
  const fullName = `E2E Chặn IP ${stamp}`;
  const res = await page.request.post('/api/v1/accounts', {
    headers: await writeHeaders(page),
    data: { email, fullName, role: 'member', totpLoginRequired: false },
  });
  expect(res.status()).toBe(201);
  return { id: ((await res.json()) as { user: { id: string } }).user.id, email, fullName };
}

test.describe('Nhật ký hệ thống — lọc nhanh theo ngày, nhóm hành động, tới ngày (ADM-060/062/066/067)', () => {
  test('"7 ngày" điền khoảng ngày lên URL; bảng có tiêu đề "Hôm nay"; dưới bảng có "Đang xem" + "Tới ngày…"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/audit-log');
    await page.getByRole('radio', { name: '7 ngày', exact: true }).click();
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
    await expect(page).toHaveURL(/to=\d{4}-\d{2}-\d{2}/);
    await expect(page.getByRole('radio', { name: '7 ngày', exact: true })).toBeChecked();
    // Vừa đăng nhập xong nên hôm nay chắc chắn có sự kiện.
    await expect(page.getByRole('rowheader', { name: 'Hôm nay' })).toBeVisible();
    await expect(page.getByText(/^Đang xem \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} → /)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tới ngày…' })).toBeVisible();

    // Ô Hành động chia nhóm theo module; chọn một mã vẫn lọc như cũ.
    await page.getByRole('button', { name: 'Hành động', exact: true }).click();
    await page.getByRole('option', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(/action=auth\.login\.ok/);
  });

  test('đường hỏng: bấm lại nút đang sáng là gỡ khoảng ngày, không để lại from/to rơi rớt', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/audit-log');
    const todayOption = page.getByRole('radio', { name: 'Hôm nay', exact: true });
    await todayOption.click();
    await expect(page).toHaveURL(/from=/);
    await todayOption.click();
    await expect(page).not.toHaveURL(/from=/);
    await expect(page).not.toHaveURL(/to=/);
  });
});

test.describe('Người dùng IMS — chi tiết tài khoản, tạm chặn theo IP, ba con số lọc (ADM-035/041/043/044)', () => {
  test('bấm dòng mở Chi tiết: thấy IP đang tạm chặn + "Còn giữ"; ô "Chưa cài 2 lớp" lọc bảng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const user = await createMember(page);
    sql(
      `INSERT INTO login_failure (user_id, ip, failed_attempts, locked_until)
       VALUES ('${user.id}', '203.0.113.77', 6, now() + interval '1 hour')`,
    );

    await page.goto('/admin/accounts');
    await page.getByRole('button', { name: /Chưa cài 2 lớp/ }).click();
    await expect(page).toHaveURL(/totp=none/);

    await searchAndWaitForFilter(page, user.fullName);
    // Ô họ tên kèm email ở dòng phụ, nên bấm vào Ô (không phải đúng chữ họ tên).
    await page.getByRole('cell', { name: new RegExp(`^${user.fullName} `) }).click();
    const dialog = page.getByRole('dialog', { name: user.fullName });
    await expect(dialog.getByRole('cell', { name: '203.0.113.77' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Gỡ tạm chặn' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: /dòng quyền két sắt/ })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Việc người này đã làm' })).toHaveAttribute(
      'href',
      new RegExp(`q=${encodeURIComponent(user.email)}`),
    );
  });

  test('đường hỏng: id không phải uuid → 400, không rơi thành lỗi 500 của Postgres', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const bad = await page.request.get('/api/v1/accounts/khong-phai-uuid/lockouts');
    expect(bad.status()).toBe(400);
  });

  test('đường hỏng: Thành viên không đọc được tạm chặn theo IP của ai (chỉ SA)', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    const denied = await page.request.get(
      '/api/v1/accounts/00000000-0000-4000-8000-000000000001/lockouts',
    );
    expect(denied.status()).toBe(403);
  });
});

test.describe('Quyền két sắt — Kiểm tra quyền giải thích "vì sao" (ADM-083)', () => {
  test('GET /vault/access/tier trả thêm nhóm của hồ sơ và dòng quyền đã khớp', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const siteId = await catalogItem(page, 'site', { code: `E2E-TC-${stamp}`, name: 'Site E2E trau chuot' });
    const typeId = await catalogItem(page, 'device_type', { name: `Loại E2E TC ${stamp}` });
    const device = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: { code: `SW-E2E-TC-${stamp}`, name: 'Switch kiểm quyền', deviceTypeId: typeId, siteId },
    });
    expect(device.status()).toBe(201);
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    const before = await page.request.get(
      `/api/v1/vault/access/tier?ownerType=device&ownerId=${deviceId}&memberEmail=${E2E_MEMBER.email}`,
    );
    // Chưa gán gì: CẤM, không dòng nào khớp — nhưng vẫn nói hồ sơ thuộc nhóm nào để SA biết gán ở đâu.
    expect(await before.json()).toEqual({
      tier: 'denied',
      groups: expect.arrayContaining([
        { scopeType: 'device_site', scopeRef: siteId },
        { scopeType: 'device_type', scopeRef: typeId },
      ]),
      matched: [],
    });
  });
});

test.describe('Sắp hết hạn — sắp theo cột, ô Chờ tự thanh lý, cửa sổ theo lịch (EX-003/005/011)', () => {
  test('bấm cột Mục → URL sort=label; chọn "tới hết tháng này" → period=month; có ô Chờ tự thanh lý', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    // Bảng chỉ có tiêu đề cột khi có dòng — gieo một mục sắp hết hạn.
    const created = await page.request.post('/api/v1/software', {
      headers: await writeHeaders(page),
      data: { code: `LIC-E2E-SORT-${uniqueStamp()}`, name: 'License sắp hết', kind: 'license', endDate: isoInDays(10) },
    });
    expect(created.status()).toBe(201);
    await page.goto('/expiry');
    await expect(page.getByRole('button', { name: /Chờ tự thanh lý/ })).toBeVisible();
    await page.getByRole('button', { name: 'Sắp xếp theo Mục' }).click();
    await expect(page).toHaveURL(/sort=label/);

    await page.getByRole('button', { name: 'Khoảng thời gian', exact: true }).click();
    await page.getByRole('option', { name: 'Quá hạn + tới hết tháng này', exact: true }).click();
    await expect(page).toHaveURL(/period=month/);
  });

  test('đường hỏng: ?sort= lạ và ?state= lạ không làm hỏng danh sách (về mặc định)', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const res = await page.request.get('/api/v1/expiry?withinDays=30&page=1&limit=5&sort=bogus&state=Gap');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { summary: { autoRetire: number } };
    expect(typeof body.summary.autoRetire).toBe('number');
  });
});

test.describe('Nhập thiết bị từ Excel — tải danh sách dòng lỗi (ADM-005)', () => {
  test('file có dòng lỗi: nút "Tải danh sách 1 dòng lỗi" trả xlsx Sheet · Dòng · Mục · Lý do', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SW-E2E-LOI-${stamp}`;
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Thiết bị');
    sheet.addRow(['Mã thiết bị *', 'Tên thiết bị *', 'Loại *', 'Site', 'Ngày mua']);
    sheet.addRow([code, 'Switch lỗi', `KHONG-CO-LOAI-E2E-${stamp}`, '', '']);
    const input = join(tmpdir(), `tb-loi-${stamp}.xlsx`);
    await wb.xlsx.writeFile(input);

    await page.goto('/devices');
    await devicesPageButton(page, 'Nhập từ Excel').click();
    await page.getByLabel('Chọn file .xlsx').setInputFiles(input);
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Tải danh sách 1 dòng lỗi (.xlsx)' }).click(),
    ]).then(([event]) => event);
    expect(download.suggestedFilename()).toBe('dong-loi-thiet-bi.xlsx');
    const saved = join(tmpdir(), `dong-loi-${stamp}.xlsx`);
    await download.saveAs(saved);
    const out = new ExcelJS.Workbook();
    await out.xlsx.readFile(saved);
    const rows = out.worksheets[0].getSheetValues().filter(Boolean) as unknown[][];
    expect(rows[0].slice(1)).toEqual(['Sheet', 'Dòng', 'Mục', 'Lý do']);
    expect(rows[1].slice(1, 4)).toEqual(['Thiết bị', 2, code]);
  });

  test('đường hỏng: gọi thẳng /import/errors không kèm file → 400', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const res = await page.request.post('/api/v1/devices/import/errors', {
      headers: await writeHeaders(page),
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('Tìm nhanh — chip trạng thái cuối (SHELL-018)', () => {
  test('hồ sơ phần mềm đã thanh lý hiện chip "Đã thanh lý" ở dòng kết quả', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const headers = await writeHeaders(page);
    const code = `SSL-E2E-PAL-${uniqueStamp()}`;
    const created = await page.request.post('/api/v1/software', {
      headers,
      data: { code, name: 'SSL đã bỏ', kind: 'ssl', endDate: isoInDays(60) },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const retired = await page.request.patch(`/api/v1/software/${id}`, {
      headers,
      data: { status: 'retired' },
    });
    expect(retired.status()).toBe(200);

    await page.goto('/');
    await expect(page.getByRole('navigation', { name: /Điều hướng/ })).toBeVisible();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Tìm nhanh' });
    await palette.getByRole('combobox').fill(code);
    await expect(palette.getByRole('option', { name: new RegExp(code) })).toContainText('Đã thanh lý');
  });
});

test.describe('Luật gửi báo cáo — công tắc Đang chạy, chip + gợi ý người nhận (EX-018/EX-020)', () => {
  test('gợi ý email của mình, bấm là thêm; email sai đỏ thành chip riêng; tắt công tắc đổi chữ', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/expiry');
    await page.getByRole('tab', { name: 'Luật gửi báo cáo' }).click();
    await page.getByRole('button', { name: 'Thêm luật', exact: true }).first().click();
    const form = page.getByRole('dialog', { name: 'Thêm luật' });

    await form.getByRole('button', { name: `Thêm ${E2E_SA.email}` }).click();
    const box = form.getByRole('textbox', { name: 'Người nhận', exact: true });
    await expect(box).toHaveValue(E2E_SA.email);
    await box.fill(`${E2E_SA.email}, khong-phai-email`);
    const chips = form.getByRole('list', { name: 'Người nhận đã nhập' }).getByRole('listitem');
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(1)).toContainText('chưa đúng dạng email');

    const toggle = form.getByRole('switch', { name: 'Đang chạy' });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(form.getByText('Đang tạm ngưng', { exact: true })).toBeVisible();
  });
});
