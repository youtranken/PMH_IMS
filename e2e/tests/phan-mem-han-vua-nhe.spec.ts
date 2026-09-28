import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  confirmAction,
  firstLogin,
  isoInDays,
  resetDevices,
  resetDigestRules,
  resetSoftware,
  resetUsers,
  rowAction,
  rowActionNames,
  timVaChoLoc,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Đợt UX vừa + nhẹ của nhóm phần mềm · sắp hết hạn · kho thanh lý. Mỗi bài có đường hạnh phúc
 * và một đường hỏng; mọi hàng tạo ra mang chữ E2E trong mã/tên để `reset-e2e.mjs` dọn được.
 */

test.use({ viewport: { width: 1280, height: 800 } });

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  resetDevices();
  resetDigestRules();
});

async function pcTypeId(page: Page): Promise<string> {
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  return catalog.deviceTypes.find((type) => type.name === 'PC')!.id;
}

async function createDevice(page: Page, code: string): Promise<string> {
  const res = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { code, name: 'Máy trạm E2E', deviceTypeId: await pcTypeId(page) },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { device: { id: string } }).device.id;
}

async function createSoftware(page: Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/v1/software', {
    headers: await writeHeaders(page),
    data,
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function assign(page: Page, softwareId: string, deviceId: string): Promise<void> {
  const res = await page.request.post(`/api/v1/software/${softwareId}/assignments`, {
    headers: await writeHeaders(page),
    data: { deviceId, overSeatReason: 'E2E vượt ghế' },
  });
  expect(res.status()).toBe(201);
}

async function retire(page: Page, softwareId: string): Promise<void> {
  const res = await page.request.patch(`/api/v1/software/${softwareId}`, {
    headers: await writeHeaders(page),
    data: { status: 'retired' },
  });
  expect(res.status()).toBe(200);
}

test.describe('Danh sách phần mềm', () => {
  test('SW-006/SW-009: mặc định giấu hồ sơ Thanh lý; "Mọi trạng thái" thì hiện; lọc kỳ hạn qua URL', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const prefix = `LIC-E2E-LOCTL-${uniqueStamp()}`;
    await createSoftware(page, {
      code: `${prefix}-SONG`,
      name: 'License còn dùng',
      kind: 'license',
      endDate: isoInDays(200),
    });
    await retire(
      page,
      await createSoftware(page, {
        code: `${prefix}-BO`,
        name: 'License đã bỏ',
        kind: 'license',
        endDate: isoInDays(200),
      }),
    );
    await createSoftware(page, {
      code: `${prefix}-VV`,
      name: 'License mua đứt',
      kind: 'license',
      licenseModel: 'perpetual',
    });

    await page.goto('/software');
    await timVaChoLoc(page, prefix);
    await expect(page.getByRole('row', { name: new RegExp(`${prefix}-SONG`) })).toBeVisible();
    await expect(
      page.getByRole('row', { name: new RegExp(`${prefix}-BO`) }),
      'Mặc định chỉ Đang dùng + Hết hạn — hồ sơ Thanh lý đã có Kho thanh lý riêng',
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Trạng thái', exact: true }).click();
    await page.getByRole('option', { name: 'Mọi trạng thái (cả Đã thanh lý)' }).click();
    await expect(page.getByRole('row', { name: new RegExp(`${prefix}-BO`) })).toBeVisible();

    // Đường hỏng: giá trị kỳ hạn lạ trên URL không được lọc ra rỗng — server bỏ qua nó.
    await page.goto(`/software?q=${prefix}&licenseModel=perpetual`);
    await expect(page.getByRole('row', { name: new RegExp(`${prefix}-VV`) })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(`${prefix}-SONG`) })).toHaveCount(0);
    await page.goto(`/software?q=${prefix}&licenseModel=la-lam`);
    await expect(page.getByRole('row', { name: new RegExp(`${prefix}-SONG`) })).toBeVisible();
  });

  test('SW-010: gõ mã máy vào ô tìm ra các license máy đó đang dùng; máy đã gỡ thì không', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const onA = await createSoftware(page, {
      code: `LIC-E2E-TIMMAY-A-${stamp}`,
      name: 'License trên máy A',
      kind: 'license',
      seatTotal: 3,
      endDate: isoInDays(200),
    });
    const deviceA = await createDevice(page, `LT-E2E-TIMMAY-${stamp}`);
    await assign(page, onA, deviceA);

    await page.goto('/software');
    await timVaChoLoc(page, `LT-E2E-TIMMAY-${stamp}`);
    await expect(page.getByRole('row', { name: new RegExp(`LIC-E2E-TIMMAY-A-${stamp}`) })).toBeVisible();

    await timVaChoLoc(page, `LT-E2E-KHONGCO-${stamp}`);
    await expect(page.getByText('Không có hồ sơ nào khớp bộ lọc.')).toBeVisible();
  });

  test('SW-007/SW-046/SW-047: Gia hạn từ menu dòng — "+1 năm", toast nói mã và ngày mới', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const code = `SSL-E2E-GHNHANH-${uniqueStamp()}`;
    await createSoftware(page, { code, name: 'SSL gia hạn nhanh', kind: 'ssl', endDate: isoInDays(20) });

    await page.goto('/software');
    await timVaChoLoc(page, code);
    await rowAction(page, code, 'Gia hạn');
    const dialog = page.getByRole('dialog', { name: `Gia hạn ${code}` });
    await expect(dialog).toBeVisible();
    // Dòng "Hạn hiện tại: dd/mm/yyyy" — câu gợi ý của ô Hạn mới (SW-048) cũng nhắc chữ này.
    await expect(dialog.getByText(/^Hạn hiện tại: \d{2}\/\d{2}\/\d{4}/)).toBeVisible();

    // Đường hỏng: bấm Gia hạn khi chưa chọn ngày → hộp ở lại, nói đúng câu.
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gia hạn' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Chọn hạn mới.');

    await dialog.getByRole('button', { name: '+1 năm', exact: true }).click();
    const renewed = page.waitForResponse((r) => r.url().endsWith('/renew'));
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gia hạn' }).click();
    expect((await renewed).status()).toBeLessThan(300);
    await expect(page.getByText(new RegExp(`^Đã gia hạn ${code} tới \\d{2}/\\d{2}/\\d{4}\\.$`))).toBeVisible();
  });
});

test.describe('Hộp gán license', () => {
  test('SW-051/SW-052: license hết ghế mở sẵn ô lý do + nút "Gán vượt ghế"; chi phí nhận "5,6tr"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-HETGHE-${stamp}`;
    const id = await createSoftware(page, {
      code,
      name: 'License hết ghế',
      kind: 'license',
      seatTotal: 1,
      endDate: isoInDays(200),
    });
    await assign(page, id, await createDevice(page, `PC-E2E-HETGHE-A-${stamp}`));
    const deviceB = `PC-E2E-HETGHE-B-${stamp}`;
    await createDevice(page, deviceB);

    await page.goto('/software');
    await timVaChoLoc(page, code);
    await rowAction(page, code, 'Gán vào máy');
    const dialog = page.getByRole('dialog', { name: `Gán license vào máy — ${code}` });
    await expect(dialog.getByText(/Đã dùng 1\/1 ghế — gán thêm sẽ vượt số ghế/)).toBeVisible();
    const reason = dialog.getByRole('textbox', { name: 'Lý do vượt số ghế', exact: true });
    await expect(reason, 'Ô lý do có sẵn ngay khi mở hộp').toBeVisible();

    await dialog.getByRole('combobox').fill(deviceB);
    await page.getByRole('option', { name: new RegExp(deviceB) }).click();
    await dialog.getByRole('textbox', { name: 'Chi phí', exact: true }).fill('5,6tr');

    // Đường hỏng: chưa ghi lý do → lỗi ngay dưới ô, không gửi đi.
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gán vượt ghế' }).click();
    await expect(reason).toHaveAccessibleDescription(/Ghi lý do vượt số ghế\./);

    await reason.fill('E2E sếp duyệt mua thêm');
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gán vượt ghế' }).click();
    await expect(page.getByText('Đã gán license vào 1 máy.')).toBeVisible();

    await page.goto(`/software/${id}?tab=devices`);
    // Ô chi phí của dòng ghế; dòng tổng ngay dưới (SW-057) mang cùng con số.
    await expect(page.getByRole('cell', { name: /5\.600\.000\s₫/ })).toBeVisible();
    await expect(page.getByText(/2 máy đang dùng · tổng chi phí 5\.600\.000 ₫/)).toBeVisible();
  });
});

test.describe('Trang hồ sơ phần mềm', () => {
  test('SW-036/SW-044/SW-045: Hết hạn thì báo trước ngày tự thanh lý; Lịch sử nói mã máy, lọc được theo nhóm', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const id = await createSoftware(page, {
      code: `LIC-E2E-TUTL-${stamp}`,
      name: 'License sắp tự thanh lý',
      kind: 'license',
      seatTotal: 2,
      endDate: isoInDays(-5),
    });
    const deviceCode = `PC-E2E-TUTL-${stamp}`;
    await assign(page, id, await createDevice(page, deviceCode));

    await page.goto(`/software/${id}`);
    const banner = page.getByRole('status').filter({ hasText: 'Tự thanh lý sau' });
    await expect(banner).toContainText('1 máy đang dùng sẽ bị gỡ license');
    await expect(banner.getByRole('button', { name: 'Gia hạn' })).toBeVisible();

    await page.getByRole('tab', { name: /^Lịch sử/ }).click();
    const history = page.getByLabel('Lịch sử');
    await expect(history.getByText(`máy ${deviceCode}`)).toBeVisible();
    await expect(history.getByText(/đổi deviceId/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Ghế', exact: true }).click();
    await expect(history.getByText('Tạo hồ sơ')).toHaveCount(0);
    await expect(history.getByText('Gán license vào máy')).toBeVisible();
    await page.getByRole('button', { name: 'Hồ sơ', exact: true }).click();
    await expect(history.getByText('Tạo hồ sơ')).toBeVisible();
  });

  test('SW-040: Thanh lý nằm trong menu ⋯ đầu trang, vẫn hỏi lại trước khi làm', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const code = `SSL-E2E-MENUTL-${uniqueStamp()}`;
    const id = await createSoftware(page, { code, name: 'SSL thanh lý từ menu', kind: 'ssl', endDate: isoInDays(90) });

    await page.goto(`/software/${id}`);
    await expect(page.getByRole('button', { name: 'Đưa vào kho thanh lý' })).toHaveCount(0);
    await rowAction(page, code, 'Đưa vào kho thanh lý');
    // Đường hỏng: Hủy thì không gì đổi.
    await page.getByRole('dialog').getByTestId('dialog-footer').getByRole('button', { name: 'Hủy' }).click();
    const still = (await (await page.request.get(`/api/v1/software/${id}`)).json()) as { status: string };
    expect(still.status).toBe('active');
  });
});

test.describe('Sắp hết hạn', () => {
  test('EX-008/EX-012: gia hạn theo lô +1 năm, rồi thấy trong tab "Đã gia hạn"', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const a = `SSL-E2E-LO-A-${stamp}`;
    const b = `DOM-E2E-LO-B-${stamp}`;
    await createSoftware(page, { code: a, name: 'SSL lô A', kind: 'ssl', endDate: isoInDays(10) });
    await createSoftware(page, { code: b, name: 'Tên miền lô B', kind: 'domain', endDate: isoInDays(12) });

    await page.goto('/expiry');
    for (const code of [a, b]) {
      await page
        .getByRole('row', { name: new RegExp(code) })
        .getByRole('checkbox', { name: 'Chọn dòng' })
        .check();
    }
    const bar = page.getByRole('group', { name: 'Gia hạn các mục đã chọn' });
    await expect(bar).toContainText('Đã chọn 2 mục.');

    // Đường hỏng: Hủy ở câu hỏi lại thì không gia hạn gì.
    await bar.getByRole('button', { name: 'Gia hạn 2 mục +1 năm' }).click();
    await page.getByRole('dialog').getByTestId('dialog-footer').getByRole('button', { name: 'Hủy' }).click();
    await expect(page.getByRole('row', { name: new RegExp(a) })).toBeVisible();

    await bar.getByRole('button', { name: 'Gia hạn 2 mục +1 năm' }).click();
    await confirmAction(page, 'Gia hạn 2 mục +1 năm');
    await expect(page.getByText('Đã gia hạn 2 mục.')).toBeVisible();

    await page.getByRole('tab', { name: 'Đã gia hạn' }).click();
    await expect(page.getByRole('row', { name: new RegExp(a) })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(b) })).toBeVisible();
    // Ô số và nút Xuất Excel thuộc về tab Danh sách.
    await expect(page.getByRole('button', { name: 'Xuất Excel' })).toHaveCount(0);
  });

  test('EX-017/EX-018/EX-025: "Thêm luật" ở đầu trang; số ngày và email sai bị báo tại ô', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/expiry');
    await page.getByRole('tab', { name: 'Luật gửi báo cáo' }).click();
    await expect(page.getByRole('button', { name: /Đã quá hạn/ }), 'Tab Luật không bày ô số').toHaveCount(0);

    await page.getByRole('button', { name: 'Thêm luật', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Thêm luật' });
    await form.getByRole('textbox', { name: 'Tên luật', exact: true }).fill(`Luật E2E ${uniqueStamp()}`);
    const within = form.getByRole('textbox', { name: 'Trong vòng (ngày)', exact: true });
    await within.fill('45 ngày');
    const recipients = form.getByRole('textbox', { name: 'Người nhận', exact: true });
    await recipients.fill('sep@pmh.com.vn, khong-phai-email');
    await form.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu' }).click();

    await expect(within).toHaveAccessibleDescription(/Nhập số ngày từ 1 tới 365/);
    await expect(recipients).toHaveAccessibleDescription(/Email chưa đúng dạng: khong-phai-email/);
    await expect(form, 'Lưu hỏng thì hộp ở lại').toBeVisible();
  });
});

test.describe('Kho thanh lý', () => {
  test('DP-001/DP-005/DP-006: chi tiết dịch tiếng Việt, lọc nằm trên URL, "Khôi phục…" mở thẳng hộp khôi phục', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const code = `LIC-E2E-KHO-VN-${uniqueStamp()}`;
    const id = await createSoftware(page, { code, name: 'License vào kho', kind: 'license', endDate: isoInDays(90) });
    await retire(page, id);

    await page.goto('/disposal?kind=software');
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    await expect(row.getByText('License phần mềm', { exact: true })).toBeVisible();
    await expect(row.getByText('license', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Phần mềm \d+$/ })).toHaveAttribute('aria-pressed', 'true');

    expect(await rowActionNames(page, code)).toEqual(['Mở hồ sơ', 'Khôi phục…']);
    await rowAction(page, code, 'Khôi phục…');
    await expect(page.getByRole('dialog', { name: new RegExp(`Khôi phục hồ sơ — ${code}`) })).toBeVisible();

    // Đường hỏng: tìm không ra thì có nút xoá bộ lọc, bấm là thấy lại.
    await page.goto('/disposal?kind=software');
    await timVaChoLoc(page, `KHONG-CO-E2E-${uniqueStamp()}`);
    await page.getByRole('button', { name: 'Xoá bộ lọc' }).click();
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
  });
});
