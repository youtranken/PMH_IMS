import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  configNumber,
  firstLogin,
  horizontalOverflow,
  isoInDays,
  isoToday,
  resetDevices,
  resetSoftware,
  resetUsers,
  rowAction,
  timVaChoLoc,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Danh sách + hồ sơ phần mềm theo vòng đời Q-03/Q-13:
 *   SW-001 bảng vừa 1280px, cột Thao tác trong khung · SW-002 cột Ghế chỉ phân số + cờ đỏ ·
 *   SW-004 một cột "Tình trạng" có số ngày tới lúc tự thanh lý (đọc từ cấu hình) ·
 *   SW-005 Hết hạn đỏ, Thanh lý xám, cả sáng lẫn tối · SW-033/034 Gia hạn/Khôi phục ·
 *   SW-035 câu hỏi lại nói đúng là ghế sẽ bị gỡ.
 */

test.use({ viewport: { width: 1280, height: 800 } });

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  resetDevices();
});

async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const button = page.getByRole('button', {
    name: theme === 'dark' ? 'Chuyển sang chế độ tối' : 'Chuyển sang chế độ sáng',
  });
  if ((await button.count()) > 0) await button.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

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

async function seatUsed(page: Page, softwareId: string): Promise<number> {
  const res = await page.request.get(`/api/v1/software/${softwareId}`);
  return ((await res.json()) as { seatUsed: number }).seatUsed;
}

test('1280px: 6 cột vừa khung, Ghế chỉ in phân số + "Hết ghế", Tình trạng đếm tới lúc tự thanh lý', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const prefix = `LIC-E2E-TT-${stamp}`;
  const expired = await createSoftware(page, {
    code: `${prefix}-HET`,
    name: 'License hết hạn 10 ngày',
    kind: 'license',
    seatTotal: 2,
    endDate: isoInDays(-10),
  });
  await assign(page, expired, await createDevice(page, `PC-E2E-TT-A-${stamp}`));
  await assign(page, expired, await createDevice(page, `PC-E2E-TT-B-${stamp}`));
  const over = await createSoftware(page, {
    code: `${prefix}-VUOT`,
    name: 'License vượt ghế',
    kind: 'license',
    seatTotal: 1,
    endDate: isoInDays(200),
  });
  await assign(page, over, await createDevice(page, `PC-E2E-TT-C-${stamp}`));
  await assign(page, over, await createDevice(page, `PC-E2E-TT-D-${stamp}`));

  const grace = configNumber('software.auto_retire_grace_days');

  await page.goto('/software');
  await timVaChoLoc(page, prefix);
  await expect(page.getByRole('row')).toHaveCount(3);

  await expect(page.getByRole('columnheader', { name: 'Tình trạng', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Tình trạng hạn' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Trạng thái', exact: true })).toHaveCount(0);

  const expiredRow = page.getByRole('row', { name: new RegExp(`${prefix}-HET`) });
  await expect(expiredRow).toContainText('2/2');
  await expect(expiredRow).toContainText('Hết ghế');
  await expect(expiredRow).not.toContainText('%');
  await expect(expiredRow.getByText('Hết hạn', { exact: true })).toBeVisible();
  // Số ngày ân hạn đọc từ cấu hình qua API — bài này đọc cùng khoá đó, không gõ 30.
  await expect(expiredRow).toContainText(`quá 10 ngày · tự thanh lý sau ${grace - 9} ngày`);

  const overRow = page.getByRole('row', { name: new RegExp(`${prefix}-VUOT`) });
  await expect(overRow).toContainText('2/1');
  await expect(overRow).toContainText('+1 vượt');

  // Cột Thao tác trong khung nhìn, không phải cuộn ngang mới thấy.
  await expect(
    page.getByRole('button', { name: `Thao tác với ${prefix}-HET` }),
  ).toBeInViewport();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test('Hết hạn đỏ, Đã thanh lý xám — ở cả sáng lẫn tối', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const prefix = `SSL-E2E-MAU-${stamp}`;
  await createSoftware(page, {
    code: `${prefix}-HET`,
    name: 'SSL hết hạn',
    kind: 'ssl',
    endDate: isoInDays(-3),
  });
  await retire(
    page,
    await createSoftware(page, {
      code: `${prefix}-TL`,
      name: 'SSL đã thanh lý',
      kind: 'ssl',
      endDate: isoInDays(100),
    }),
  );

  await page.goto('/software');
  await timVaChoLoc(page, prefix);
  await expect(page.getByRole('row')).toHaveCount(3);

  const expiredBadge = page
    .getByRole('row', { name: new RegExp(`${prefix}-HET`) })
    .getByText('Hết hạn', { exact: true });
  const retiredBadge = page
    .getByRole('row', { name: new RegExp(`${prefix}-TL`) })
    .getByText('Đã thanh lý', { exact: true });

  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    const [expiredColor, retiredColor] = await Promise.all([
      expiredBadge.evaluate((el) => getComputedStyle(el).color),
      retiredBadge.evaluate((el) => getComputedStyle(el).color),
    ]);
    expect(expiredColor, `Hết hạn phải khác màu Thanh lý ở chế độ ${theme}`).not.toBe(
      retiredColor,
    );
    const danger = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
    );
    const probe = await page.evaluate((value) => {
      const el = document.createElement('span');
      el.style.color = value;
      document.body.append(el);
      const color = getComputedStyle(el).color;
      el.remove();
      return color;
    }, danger);
    expect(expiredColor, `Hết hạn dùng tone danger ở chế độ ${theme}`).toBe(probe);
  }
});

test('thanh lý từ danh sách: câu hỏi lại nói ghế sẽ BỊ GỠ và kể mã máy; xác nhận thì ghế về 0', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const code = `LIC-E2E-GO-${stamp}`;
  const id = await createSoftware(page, {
    code,
    name: 'License sắp thanh lý',
    kind: 'license',
    seatTotal: 5,
    endDate: isoInDays(100),
  });
  await assign(page, id, await createDevice(page, `PC-E2E-GO-A-${stamp}`));
  await assign(page, id, await createDevice(page, `PC-E2E-GO-B-${stamp}`));

  await page.goto('/software');
  await timVaChoLoc(page, code);
  await expect(page.getByRole('row')).toHaveCount(2);
  await rowAction(page, code, 'Đưa vào kho thanh lý');

  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(dialog).toContainText('2 máy đang dùng sẽ bị gỡ license');
  await expect(dialog).toContainText(`PC-E2E-GO-A-${stamp}`);
  await expect(dialog).toContainText(`PC-E2E-GO-B-${stamp}`);
  await expect(dialog).not.toContainText('giữ nguyên');

  // Đường hỏng: Hủy thì không gì đổi.
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  expect(await seatUsed(page, id)).toBe(2);

  await rowAction(page, code, 'Đưa vào kho thanh lý');
  await dialog.getByRole('button', { name: 'Đưa vào kho thanh lý' }).click();
  await expect(page.getByText('Đã đưa vào kho thanh lý.')).toBeVisible();
  expect(await seatUsed(page, id)).toBe(0);
});

test('hồ sơ Thanh lý: băng nói ai/khi nào, không có Gia hạn; Khôi phục… gán lại máy đã tick', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const code = `LIC-E2E-KP-${stamp}`;
  const id = await createSoftware(page, {
    code,
    name: 'License khôi phục',
    kind: 'license',
    seatTotal: 3,
    endDate: isoInDays(-5),
  });
  const deviceA = `PC-E2E-KP-A-${stamp}`;
  const deviceB = `PC-E2E-KP-B-${stamp}`;
  await assign(page, id, await createDevice(page, deviceA));
  await assign(page, id, await createDevice(page, deviceB));
  await retire(page, id);

  await page.goto(`/software/${id}`);
  await expect(page.getByRole('status').filter({ hasText: 'Đã thanh lý ngày' })).toContainText(
    `bởi ${E2E_SA.email}`,
  );
  await expect(page.getByRole('button', { name: 'Gia hạn', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Khôi phục…' }).first().click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`Khôi phục hồ sơ — ${code}`) });
  await expect(dialog).toBeVisible();
  // Hạn mới có sẵn +1 năm — người dùng không phải tự nhớ phải nhập hạn.
  await expect(dialog.getByRole('button', { name: 'Hạn mới' })).toContainText(
    String(Number(isoToday().slice(0, 4)) + 1),
  );
  await dialog.getByRole('checkbox', { name: new RegExp(deviceA) }).check();
  await dialog.getByRole('button', { name: 'Khôi phục', exact: true }).click();

  await expect(page.getByText('Đã khôi phục hồ sơ.')).toBeVisible();
  await expect(page.getByText('Đã gán lại 1 máy.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gia hạn', exact: true })).toBeVisible();
  expect(await seatUsed(page, id)).toBe(1);
});

test('Khôi phục: tick nhiều máy hơn số ghế thì bị chặn trong hộp, hồ sơ vẫn Thanh lý', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const code = `LIC-E2E-KPX-${stamp}`;
  const id = await createSoftware(page, {
    code,
    name: 'License 1 ghế',
    kind: 'license',
    seatTotal: 1,
    endDate: isoInDays(50),
  });
  const deviceA = `PC-E2E-KPX-A-${stamp}`;
  const deviceB = `PC-E2E-KPX-B-${stamp}`;
  await assign(page, id, await createDevice(page, deviceA));
  await assign(page, id, await createDevice(page, deviceB));
  await retire(page, id);

  await page.goto(`/software/${id}`);
  await page.getByRole('button', { name: 'Khôi phục…' }).first().click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`Khôi phục hồ sơ — ${code}`) });
  await dialog.getByRole('checkbox', { name: new RegExp(deviceA) }).check();
  await dialog.getByRole('checkbox', { name: new RegExp(deviceB) }).check();
  await dialog.getByRole('button', { name: 'Khôi phục', exact: true }).click();

  await expect(dialog.getByText(/Hồ sơ có 1 ghế/)).toBeVisible();
  const after = await page.request.get(`/api/v1/software/${id}`);
  expect(((await after.json()) as { status: string }).status).toBe('retired');
});

test('license vĩnh viễn: không có nút Gia hạn', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const id = await createSoftware(page, {
    code: `LIC-E2E-VV-${uniqueStamp()}`,
    name: 'License mua đứt',
    kind: 'license',
    licenseModel: 'perpetual',
    seatTotal: 2,
  });
  await page.goto(`/software/${id}`);
  await expect(page.getByRole('button', { name: 'Sửa hồ sơ' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gia hạn', exact: true })).toHaveCount(0);
});
