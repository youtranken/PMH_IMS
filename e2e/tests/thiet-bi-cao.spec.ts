import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetDevices,
  resetIpam,
  resetSecrets,
  resetSoftware,
  resetUsers,
  timVaChoLoc,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Mảng thiết bị — đợt sửa giao diện mức cao (Q-14). Mỗi nhóm canh một lỗi đã thấy trên ảnh
 * chụp màn thật ở 1280px có sidebar.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetIpam();
  resetSecrets();
});

async function deviceTypeId(page: Page, name: string): Promise<string> {
  const res = await page.request.get('/api/v1/catalog');
  const catalog = (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  return (catalog.deviceTypes.find((t) => t.name === name) ?? catalog.deviceTypes[0]).id;
}

async function createDevice(
  page: Page,
  data: { code: string; name: string; type?: string } & Record<string, unknown>,
): Promise<string> {
  const { type, ...rest } = data;
  const created = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { ...rest, deviceTypeId: await deviceTypeId(page, type ?? 'PC') },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

/** Cấp một IP cho máy. Tên dải mang chữ E2E để `reset-e2e.mjs` dọn được. */
async function assignIp(page: Page, deviceId: string, stamp: string): Promise<string> {
  const headers = await writeHeaders(page);
  const octet = Number(stamp) % 200;
  const subnet = await page.request.post('/api/v1/ipam/subnets', {
    headers,
    data: { cidr: `172.23.${octet}.0/28`, name: `LAN E2E tim IP ${stamp}` },
  });
  expect(subnet.status(), await subnet.text()).toBe(201);
  const subnetId = ((await subnet.json()) as { id: string }).id;
  const address = `172.23.${octet}.5`;
  const ip = await page.request.post('/api/v1/ipam/addresses', {
    headers,
    data: { subnetId, address, deviceId },
  });
  expect(ip.status(), await ip.text()).toBe(201);
  return address;
}

test.describe('DEV-013 · tìm thiết bị theo IP, người sử dụng, bộ phận', () => {
  test('đường hạnh phúc: gõ IP hoặc tên người dùng ra đúng máy', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-TIM-${stamp}`;
    const deviceId = await createDevice(page, {
      code,
      name: 'Máy trạm',
      assignedTo: 'Chị Bình',
      department: 'Phòng Kế hoạch',
    });
    const address = await assignIp(page, deviceId, stamp);

    await page.goto('/devices');
    // Placeholder nói đúng những gì ô tìm làm được.
    await expect(
      page.getByRole('searchbox', { name: 'Tìm mã, tên, serial, IP hoặc người dùng' }),
    ).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(code) });

    await timVaChoLoc(page, address);
    await expect(row).toBeVisible();
    await timVaChoLoc(page, 'chi binh');
    await expect(row).toBeVisible();
    await timVaChoLoc(page, 'ke hoach');
    await expect(row).toBeVisible();
  });

  test('đường hỏng: IP chưa cấp cho máy nào thì nói không khớp, không chỉ bừa', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-TIM-${stamp}`;
    const deviceId = await createDevice(page, { code, name: 'Máy trạm' });
    const address = await assignIp(page, deviceId, stamp);
    // Cùng dải, khác địa chỉ: gõ đủ 4 nhóm là khớp ĐÚNG, không khớp theo tiền tố.
    const other = address.replace(/\.5$/, '.9');

    await page.goto('/devices');
    await timVaChoLoc(page, other);
    await expect(page.getByRole('row', { name: new RegExp(code) })).toHaveCount(0);
    // Câu rỗng nêu lại đúng từ khoá vừa gõ (DEV-009): "không khớp", không phải "kho trống".
    await expect(page.getByText(`Không có thiết bị nào khớp “${other}”.`)).toBeVisible();
  });
});

/** Chiều ngang có sidebar mà ảnh chụp lỗi dùng — nơi bảng tràn và nút Sửa bị cắt. */
const DESKTOP = { width: 1280, height: 800 };

/** Phần tử nằm TRỌN trong bề ngang cửa sổ (không phải cuộn ngang mới thấy). */
async function expectInsideWidth(page: Page, locator: Locator, what: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${what}: không có hộp bao`).not.toBeNull();
  expect(box!.x, `${what}: tràn mép trái`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${what}: tràn mép phải`).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
}

/** Hai hộp có chồng lên nhau không. */
function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const button = page.getByRole('button', {
    name: theme === 'dark' ? 'Chuyển sang chế độ tối' : 'Chuyển sang chế độ sáng',
  });
  if ((await button.count()) > 0) await button.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function addPort(page: Page, deviceId: string, portLabel: string, extra = {}): Promise<void> {
  const res = await page.request.post(`/api/v1/devices/${deviceId}/ports`, {
    headers: await writeHeaders(page),
    data: { portLabel, ...extra },
  });
  expect(res.status(), await res.text()).toBe(201);
}

async function addSecret(page: Page, deviceId: string, label: string): Promise<void> {
  const res = await page.request.post('/api/v1/vault/secrets', {
    headers: await writeHeaders(page),
    data: {
      ownerType: 'device',
      ownerId: deviceId,
      kind: 'password',
      label,
      username: 'admin',
      value: 'Qw3rty!@#Manh2026',
      note: 'Ghi chú dài để thử bảng két trong cột chính của trang thiết bị',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

test.describe('DEV-001 · danh sách thiết bị vừa 1280px có sidebar', () => {
  test.use({ viewport: DESKTOP });

  test('nút Sửa của mọi dòng nằm trong khung, cột Tên đủ rộng, Loại là dòng phụ', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-RONG-${stamp}`;
    await createDevice(page, {
      code,
      name: 'Laptop Nguyễn Văn An phòng kế toán',
      serial: `DL-${stamp}`,
      assignedTo: 'Nguyễn Văn An',
      department: 'Kế toán',
      warrantyEnd: '2027-12-31',
    });

    await page.goto('/devices');
    await timVaChoLoc(page, code);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();

    await expectInsideWidth(page, row.getByRole('button', { name: `Sửa máy ${code}` }), 'nút Sửa');
    const nameCell = row.getByRole('cell', { name: /Laptop Nguyễn Văn An/ });
    expect((await nameCell.boundingBox())!.width).toBeGreaterThanOrEqual(200);
    // Loại máy vẫn đọc được — chỉ không còn là một cột riêng.
    await expect(nameCell).toContainText('PC');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('đường hỏng: bảng buộc phải cuộn ngang thì cột thao tác vẫn DÍNH mép phải', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-HEP-${stamp}`;
    await createDevice(page, { code, name: 'Máy trạm', assignedTo: 'Chị Lan' });

    await page.goto('/devices');
    await timVaChoLoc(page, code);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expectInsideWidth(page, row.getByRole('button', { name: `Sửa máy ${code}` }), 'nút Sửa');
  });
});

test.describe('DEV-043/044 · bản đồ quan hệ không chồng, mã không ngắt', () => {
  test.use({ viewport: DESKTOP });

  test('nút không đè hạch hay đè nhau; số đếm không bị cắt; hạch một dòng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SW-E2E-CORE-${stamp}`;
    const deviceId = await createDevice(page, { code, name: 'Switch lõi', type: 'Switch' });
    for (let i = 1; i <= 7; i += 1) await addPort(page, deviceId, `Gi1/0/${i}`);
    await assignIp(page, deviceId, stamp);
    await addSecret(page, deviceId, `Mật khẩu enable E2E ${stamp}`);

    await page.goto(`/devices/${deviceId}`);
    const hub = page.getByTestId('rmap-hub');
    await expect(hub).toHaveText(code);
    const nodes = [
      page.getByRole('button', { name: /Cổng của máy này/ }),
      page.getByRole('button', { name: /Địa chỉ IP/ }).first(),
      page.getByRole('button', { name: /Két sắt/ }).first(),
    ];
    for (const node of nodes) await expect(node).toBeVisible();

    const hubBox = (await hub.boundingBox())!;
    // Mã một dòng: đo số hộp dòng của chữ trong hạch.
    const hubText = await hub.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getClientRects().length;
    });
    expect(hubText, 'mã trong hạch bị ngắt thành nhiều dòng').toBe(1);

    const boxes = [];
    for (const node of nodes) {
      const box = (await node.boundingBox())!;
      expect(overlaps(box, hubBox), 'nút đè lên hạch').toBe(false);
      for (const other of boxes) expect(overlaps(box, other), 'hai nút đè nhau').toBe(false);
      boxes.push(box);
      /* Đo bằng hộp của chính con số, không bằng `scrollWidth` của nút: dây nối là `::after`
         nằm ngoài mép nút (tới mép hạch), nên nút cột trái luôn "tràn" đúng một khe cột. */
      const countBox = (await node.getByText(/^\d+$/).boundingBox())!;
      expect(
        countBox.x >= box.x - 1 && countBox.x + countBox.width <= box.x + box.width + 1,
        'số đếm bị đẩy ra ngoài mép nút',
      ).toBe(true);
    }
    // Số 7 của "Cổng của máy này" nằm TRONG nút.
    await expect(nodes[0]).toContainText('7');

    /* Tiêu đề nút đọc trọn: không cụt chữ (ellipsis hay line-clamp đều làm nội dung cao/rộng
       hơn khung nhìn thấy), và có `title` cho lúc tên dài hơn hai dòng. */
    const titles = ['Cổng của máy này', 'Địa chỉ IP', 'Két sắt'];
    for (const [i, node] of nodes.entries()) {
      const title = node.getByTitle(titles[i], { exact: true });
      await expect(title).toHaveText(titles[i]);
      const cut = await title.evaluate(
        (el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
      );
      expect(cut, `tiêu đề "${titles[i]}" bị cắt`).toBe(false);
    }
  });

  test('đường hỏng: máy đã thanh lý không giữ gì — chỉ có câu, không có hạch bị câu đè (sáng + tối)', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-RONG-${stamp}`;
    const deviceId = await createDevice(page, { code, name: 'Máy cũ' });
    const retired = await page.request.patch(`/api/v1/devices/${deviceId}/status`, {
      headers: await writeHeaders(page),
      data: { status: 'retired' },
    });
    expect(retired.status()).toBeLessThan(300);

    await page.goto(`/devices/${deviceId}`);
    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await expect(page.getByText(/chưa giữ gì của ai/)).toBeVisible();
      await expect(page.getByTestId('rmap-hub')).toHaveCount(0);
    }
  });
});

test.describe('DEV-050 · hộp Thanh lý nói rõ sẽ gỡ gì', () => {
  test.use({ viewport: DESKTOP });

  test('không còn nút "Xem lượt thanh lý cắt gì" rời rạc; hộp liệt kê IP sẽ gỡ và thứ giữ nguyên', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-TL-${stamp}`;
    const deviceId = await createDevice(page, { code, name: 'Máy sắp thanh lý' });
    const address = await assignIp(page, deviceId, stamp);

    await page.goto(`/devices/${deviceId}`);
    await expect(page.getByRole('button', { name: /cắt gì/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Thanh lý', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(new RegExp(address.replace(/\./g, '\\.'))).first()).toBeVisible();
    await expect(dialog.getByText('Hồ sơ máy và toàn bộ lịch sử')).toBeVisible();
    // Huỷ thì không có gì xảy ra.
    await dialog.getByRole('button', { name: 'Hủy' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Thanh lý', exact: true })).toBeVisible();
  });

  test('đường hỏng: bị chặn 409 lần thứ hai thì hộp vẫn dựng lại, không giữ chữ đã gõ lượt trước', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-TL2-${stamp}`;
    const deviceId = await createDevice(page, { code, name: 'Máy bị chặn hai lần' });
    const address = await assignIp(page, deviceId, stamp);

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('button', { name: 'Thanh lý', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const typeCode = dialog.getByLabel(`Gõ lại mã máy ${code} để xác nhận`);
    const only = dialog.getByRole('radio', { name: /Chỉ thanh lý/ });
    const cleanup = dialog.getByRole('radio', { name: 'Gỡ hết rồi thanh lý' });
    const submit = dialog.getByRole('button', { name: 'Thanh lý', exact: true });

    // Lượt 1: "Chỉ thanh lý" trong khi máy còn giữ IP → 409, hộp mở lại với danh sách vướng.
    const first = page.waitForResponse((r) => r.url().includes(`/devices/${deviceId}/status`));
    await submit.click();
    expect((await first).status()).toBe(409);
    await expect(dialog.getByText(new RegExp(address.replace(/\./g, '\\.'))).first()).toBeVisible();

    // Gõ dở mã ở nhánh "Gỡ hết", rồi đổi ý quay lại "Chỉ thanh lý" và bấm lần nữa → 409 lần 2.
    await cleanup.check();
    await typeCode.fill('PC-E2E');
    await only.check();
    const second = page.waitForResponse((r) => r.url().includes(`/devices/${deviceId}/status`));
    await submit.click();
    expect((await second).status()).toBe(409);

    // Hộp dựng lại từ đầu: chọn "Gỡ hết" thì ô mã phải TRỐNG, không còn chữ của lượt trước.
    await expect(only).toBeChecked();
    await cleanup.check();
    await expect(typeCode).toHaveValue('');
    await expect(submit).toBeDisabled();
  });
});

test.describe('DEV-047 · VLT-040 · két trong trang thiết bị', () => {
  test.use({ viewport: DESKTOP });

  test('nút Xem luôn trong khung; menu ⋯ nêu tên ngăn và không làm trôi cột Tên gọi', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createDevice(page, {
      code: `SW-E2E-KET-${stamp}`,
      name: 'Switch két',
      type: 'Switch',
    });
    const label = `Mật khẩu enable E2E ${stamp}`;
    await addSecret(page, deviceId, label);

    await page.goto(`/devices/${deviceId}?tab=vault`);
    const row = page.getByRole('row', { name: new RegExp(label) });
    await expect(row).toBeVisible();
    await expectInsideWidth(page, row.getByRole('button', { name: 'Xem' }), 'nút Xem');
    // Loại, ghi chú, mốc đổi giá trị gần nhất (VLT-054) là dòng phụ — vẫn đọc được.
    await expect(row).toContainText(/Đổi giá trị \d+ ngày trước/);

    // Neo đầu: ô Thao tác cũng mang tên ngăn ("Thao tác với …") nên khớp giữa chuỗi là ra hai ô.
    const labelCell = row.getByRole('cell', { name: new RegExp(`^${label}`) });
    const before = (await labelCell.boundingBox())!.x;
    await row.getByRole('button', { name: `Thao tác với ${label}` }).click();
    await expect(page.getByRole('menu')).toContainText(label);
    expect((await labelCell.boundingBox())!.x, 'mở menu làm bảng cuộn ngang').toBeCloseTo(before, 0);
    await page.keyboard.press('Escape');
  });
});

test.describe('DEV-048 · bảng port map', () => {
  test.use({ viewport: DESKTOP });

  test('cột Cổng dính trái, thao tác dính phải; mở ⋯ không cuộn bảng và nêu tên cổng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createDevice(page, {
      code: `RT-E2E-PM-${stamp}`,
      name: 'Router biên',
      type: 'Router',
    });
    await addPort(page, deviceId, 'WAN1', {
      connectedLabel: 'Modem nhà mạng tầng trệt',
      usedBy: 'Phòng IT',
      vlan: '100',
      note: 'Ghi chú dài: đường chính, đừng rút khi chưa báo',
    });

    await page.goto(`/devices/${deviceId}?tab=ports`);
    const row = page.getByRole('row', { name: /WAN1/ });
    await expect(row).toBeVisible();
    const actions = row.getByRole('button', { name: 'Thao tác với WAN1' });
    await expectInsideWidth(page, actions, 'nút thao tác cổng');
    const portCell = row.getByRole('cell', { name: 'WAN1', exact: true });
    const before = (await portCell.boundingBox())!.x;
    await actions.click();
    await expect(page.getByRole('menu')).toContainText('WAN1');
    expect((await portCell.boundingBox())!.x).toBeCloseTo(before, 0);
    await page.keyboard.press('Escape');
    // VLAN và ghi chú có trong dòng (cuộn khung bảng là tới), không bị cắt khỏi DOM.
    await expect(row).toContainText('100');
    await expect(row).toContainText('đừng rút');
  });
});

test.describe('DEV-068 · khu License đang cài không tràn card', () => {
  test.use({ viewport: DESKTOP });

  test('một tiêu đề duy nhất, mã license một dòng, không đè sang cột phải', async ({ page }) => {
    resetSoftware();
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createDevice(page, { code: `LT-E2E-LIC-${stamp}`, name: 'Laptop' });
    const licenseCode = `LIC-E2E-M365-${stamp}`;
    const headers = await writeHeaders(page);
    const sw = await page.request.post('/api/v1/software', {
      headers,
      data: { code: licenseCode, name: 'Microsoft 365 Business', kind: 'license', seatTotal: 5, endDate: '2028-12-31' },
    });
    expect(sw.status()).toBe(201);
    const softwareId = ((await sw.json()) as { id: string }).id;
    const assigned = await page.request.post(`/api/v1/software/${softwareId}/assignments`, {
      headers,
      data: { deviceId, cost: 350_000, contract: `HD-${stamp}` },
    });
    expect(assigned.status()).toBe(201);

    await page.goto(`/devices/${deviceId}`);
    const section = page.getByRole('region', { name: /License đang cài/ });
    await expect(section).toBeVisible();
    await expect(page.getByText(/Phần mềm đang cài/)).toHaveCount(0);
    const link = section.getByRole('link', { name: licenseCode });
    await expect(link).toBeVisible();
    const linkBox = (await link.boundingBox())!;
    const lineHeight = await link.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || 20);
    expect(linkBox.height, 'mã license gãy nhiều dòng').toBeLessThan(lineHeight * 1.8);
    const sectionBox = (await section.boundingBox())!;
    const overflow = await section.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, 'nội dung tràn khỏi card').toBeLessThanOrEqual(1);
    expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(sectionBox.x + sectionBox.width);
  });
});
