import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetDevices,
  resetIpam,
  resetUsers,
  rowAction,
  rowActionNames,
  writeHeaders,
} from './helpers';

/**
 * NET-037: rule NAT đã gỡ phải TRA LẠI ĐƯỢC — hộp Gỡ hứa điều đó.
 *
 * Mặc định sổ chỉ bày rule còn trong sổ; chip "Đã gỡ" bày thêm rule đã gỡ, gạch ngang, kèm
 * "Đã gỡ dd/mm/yyyy · bởi … · lý do", và chỉ còn thao tác Lịch sử.
 */

test.beforeEach(() => {
  resetUsers();
  resetIpam();
  resetDevices();
});

async function setUp(page: Page) {
  const stamp = Date.now().toString().slice(-5);
  const headers = await writeHeaders(page);
  const catalog = (await (await page.request.get('/api/v1/catalog')).json()) as {
    deviceTypes: { id: string; name: string }[];
  };
  const type = catalog.deviceTypes.find((t) => t.name === 'Firewall') ?? catalog.deviceTypes[0];
  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: `RT-E2E-GO-${stamp}`, name: 'Draytek E2E', deviceTypeId: type.id },
  });
  expect(device.status(), await device.text()).toBe(201);
  const routerId = ((await device.json()) as { device: { id: string } }).device.id;
  const port = 20000 + (Number(stamp) % 20000);
  const rule = await page.request.post('/api/v1/ipam/nat', {
    headers,
    data: {
      deviceId: routerId,
      protocol: 'tcp',
      externalPorts: String(port),
      internalIp: '172.16.250.5',
      internalPort: 80,
      usedBy: 'Phòng IT E2E',
      reason: `camera cũ E2E ${stamp}`,
    },
  });
  expect(rule.status(), await rule.text()).toBe(201);
  const ruleId = ((await rule.json()) as { id: string }).id;
  return { stamp, headers, ruleId, ports: `TCP ${port}` };
}

async function voidRule(page: Page, f: Awaited<ReturnType<typeof setUp>>) {
  const res = await page.request.delete(`/api/v1/ipam/nat/${f.ruleId}`, {
    headers: f.headers,
    data: { reason: 'dịch vụ đã ngừng E2E' },
  });
  expect(res.status()).toBeLessThan(300);
}

test.describe('Sổ NAT — rule đã gỡ (NET-037)', () => {
  test('API: mặc định không có rule đã gỡ; includeVoided=true trả kèm ai gỡ, lúc nào, vì sao', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    await voidRule(page, f);

    const plain = (await (await page.request.get('/api/v1/ipam/nat')).json()) as { id: string }[];
    expect(plain.some((r) => r.id === f.ruleId)).toBe(false);

    const withVoided = (await (
      await page.request.get('/api/v1/ipam/nat?includeVoided=true')
    ).json()) as { id: string; voidedAt: string | null; voidedBy: string; voidReason: string }[];
    const gone = withVoided.find((r) => r.id === f.ruleId);
    expect(gone).toMatchObject({ voidedBy: E2E_SA.email, voidReason: 'dịch vụ đã ngừng E2E' });
    expect(gone?.voidedAt).toBeTruthy();

    const bad = await page.request.get('/api/v1/ipam/nat?includeVoided=co');
    expect(bad.status(), 'cờ rác phải là 400, không lặng lẽ coi như false').toBe(400);
  });

  test('màn: hộp Gỡ nói đúng đường tra lại; chip "Đã gỡ" bày lại rule, chỉ còn Lịch sử', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    await page.goto('/nat');

    await rowAction(page, f.ports, 'Gỡ');
    const remove = page.getByRole('dialog');
    await expect(remove.getByText(/Bật chip "Đã gỡ"/)).toBeVisible();
    await remove.getByRole('textbox', { name: 'Lý do gỡ' }).fill('dịch vụ đã ngừng E2E');
    await remove.getByRole('button', { name: 'Gỡ', exact: true }).click();
    await expect(remove).toHaveCount(0);

    const row = page.getByRole('row', { name: new RegExp(f.ports) });
    await expect(row, 'mặc định sổ chỉ bày rule còn trong sổ').toHaveCount(0);

    const chips = page.getByRole('group', { name: 'Lọc theo trạng thái rule' });
    await chips.getByRole('button', { name: /^Đã gỡ/ }).click();
    await expect(row).toBeVisible();
    await expect(row.getByText(/Đã gỡ \d{2}\/\d{2}\/\d{4} · bởi .* · dịch vụ đã ngừng E2E/)).toBeVisible();
    expect(await rowActionNames(page, f.ports)).toEqual(['Lịch sử']);

    await rowAction(page, f.ports, 'Lịch sử');
    const history = page.getByRole('dialog', { name: new RegExp(`Lịch sử rule ${f.ports}`) });
    await expect(history.getByText(/dịch vụ đã ngừng E2E/)).toBeVisible();
  });

  test('rule còn sống có thêm Lịch sử trong menu; tắt chip "Đang mở" thì nó biến khỏi bảng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    await page.goto('/nat');
    expect(await rowActionNames(page, f.ports)).toEqual(['Sửa', 'Lịch sử', 'Tắt rule', 'Gỡ']);

    const chips = page.getByRole('group', { name: 'Lọc theo trạng thái rule' });
    await chips.getByRole('button', { name: /^Đang mở/ }).click();
    await expect(page.getByRole('row', { name: new RegExp(f.ports) })).toHaveCount(0);
  });

  test('tắt / bật rule ngay từ menu dòng, không phải mở form Sửa', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    await page.goto('/nat');
    const row = page.getByRole('row', { name: new RegExp(f.ports) });
    await expect(row.getByText('Đang mở', { exact: true })).toBeVisible();

    // Đường hỏng: hỏi lại rồi bấm Hủy thì KHÔNG đổi gì.
    await rowAction(page, f.ports, 'Tắt rule');
    // Nút ✕ của hộp hỏi lại cũng mang tên "Hủy" — bấm nút ở chân hộp.
    await page.getByRole('dialog').getByTestId('dialog-footer').getByRole('button', { name: 'Hủy' }).click();
    await expect(row.getByText('Đang mở', { exact: true })).toBeVisible();

    await rowAction(page, f.ports, 'Tắt rule');
    await page.getByRole('dialog').getByRole('button', { name: 'Tắt rule' }).click();
    await expect(page.getByText('Đã đổi trạng thái rule.')).toBeVisible();
    // "Đã tắt" là huy hiệu ở cột Trạng thái riêng, dòng KHÔNG bị làm mờ cả.
    await expect(row.getByText('Đã tắt', { exact: true })).toBeVisible();

    await rowAction(page, f.ports, 'Bật rule');
    await page.getByRole('dialog').getByRole('button', { name: 'Bật rule' }).click();
    await expect(row.getByText('Đang mở', { exact: true })).toBeVisible();
  });

  test('tìm không ra thì nói "không khớp bộ lọc", không nói sổ trống; bộ lọc nằm trên URL', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await setUp(page);
    await page.goto('/nat?q=khong-co-rule-nao-E2E');
    await expect(page.getByText('Không có rule nào khớp bộ lọc.')).toBeVisible();
    await expect(page.getByText('Chưa có rule NAT nào')).toHaveCount(0);
    await expect(page.getByRole('searchbox')).toHaveValue('khong-co-rule-nao-E2E');
  });
});

test.describe('390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('chip lọc và dòng đã gỡ không làm trang tràn ngang', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    await voidRule(page, f);
    await page.goto('/nat');
    await page
      .getByRole('group', { name: 'Lọc theo trạng thái rule' })
      .getByRole('button', { name: /^Đã gỡ/ })
      .click();
    await expect(page.getByText(/dịch vụ đã ngừng E2E/).first()).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
