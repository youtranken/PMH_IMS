import { expect, test, type Page } from '@playwright/test';
import { APP_ORIGIN, E2E_SA, firstLogin, resetDevices, resetIsp, resetUsers, uniqueStamp } from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetIsp();
  resetDevices();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function createDevice(page: Page, code: string): Promise<string> {
  const csrf = await csrfOf(page);
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const fw = catalog.deviceTypes.find((type) => type.name === 'Firewall')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
    data: { code, name: 'Draytek biên', deviceTypeId: fw.id },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

async function createLine(page: Page, data: Record<string, unknown>) {
  const csrf = await csrfOf(page);
  const response = await page.request.post('/api/v1/isp-lines', {
    headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
    data,
  });
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

test.describe('Đường truyền ISP', () => {
  test('đường hạnh phúc: hotline và số hợp đồng hiện NGAY trên danh sách', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `ISP-E2E-${stamp}`;

    const created = await createLine(page, {
      code,
      provider: 'FPT Telecom',
      bandwidth: '200 Mbps',
      wanIp: '113.161.0.10',
      hotline: '1900 6600',
      contractNo: `HD-${stamp}`,
      startDate: '2026-01-01',
    });
    expect(created.status).toBe(201);

    await page.goto('/isp-lines');
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    // Mục tiêu của story: 2h sáng nhìn thấy ngay, không phải bấm vào trong.
    await expect(row.getByRole('link', { name: '1900 6600' })).toBeVisible();
    await expect(row.getByText(`HD-${stamp}`)).toBeVisible();
    // Hotline bấm gọi được thẳng từ điện thoại.
    await expect(row.getByRole('link', { name: '1900 6600' })).toHaveAttribute(
      'href',
      'tel:19006600',
    );
  });

  test('gắn Draytek: trang thiết bị hiện ngược lại đường ISP kèm hotline', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createDevice(page, `FW-E2E-${stamp}`);

    // Chưa gắn đường nào: khu mở rộng phải RỖNG.
    await page.goto(`/devices/${deviceId}`);
    await expect(page.getByRole('heading', { name: 'Đường truyền ISP' })).toHaveCount(0);

    const created = await createLine(page, {
      code: `ISP-E2E-FW-${stamp}`,
      provider: 'Viettel',
      deviceId,
      hotline: '18008098',
      contractNo: `HD-FW-${stamp}`,
    });
    expect(created.status).toBe(201);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Đường truyền ISP' })).toBeVisible();
    // Hỏi trong KHU "Đường truyền ISP": bản đồ quan hệ ở đầu trang cũng in hotline ra một dòng.
    const khuIsp = page.getByRole('region', { name: 'Đường truyền ISP' });
    await expect(khuIsp.getByText('18008098')).toBeVisible();
    await expect(khuIsp.getByText(`HD-FW-${stamp}`)).toBeVisible();
  });

  test('đường hỏng: thiếu nhà mạng, gửi ngày hết hạn, thiết bị không tồn tại', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    const noProvider = await createLine(page, { code: `ISP-E2E-NP-${stamp}` });
    expect(noProvider.status).toBe(400);
    expect(String(noProvider.body.message)).toContain('nhà mạng');

    // Q-04: đường truyền không có hạn. Client cũ còn gửi `endDate` thì bị từ chối, không lặng
    // lẽ bỏ qua — nếu không, người gửi tưởng hạn đã được lưu.
    const withEnd = await createLine(page, {
      code: `ISP-E2E-BR-${stamp}`,
      provider: 'FPT',
      endDate: '2027-01-01',
    });
    expect(withEnd.status).toBe(400);

    const ghostDevice = await createLine(page, {
      code: `ISP-E2E-GD-${stamp}`,
      provider: 'FPT',
      deviceId: '00000000-0000-4000-8000-000000000000',
    });
    expect(ghostDevice.status).toBe(400);
    expect(ghostDevice.body).toMatchObject({ code: 'DEVICE_NOT_FOUND' });
  });

  /**
   * Q-04: line không có hạn, sống tới khi thanh lý. Không còn cửa gia hạn, không còn cột hạn,
   * không có mặt trong cỗ máy nhắc hạn — và thanh lý phải đọc ra được ai, ngày nào.
   */
  test('không hạn, không gia hạn; thanh lý ghi rõ người và ngày', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `ISP-E2E-TL-${stamp}`;
    const created = await createLine(page, { code, provider: 'VNPT' });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty('endDate');
    const id = String(created.body.id);
    const csrf = await csrfOf(page);

    const renew = await page.request.post(`/api/v1/isp-lines/${id}/renew`, {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { endDate: '2027-12-31' },
    });
    expect(renew.status()).toBe(404);

    const kinds = await page.request.get('/api/v1/expiry/kinds');
    const kindList = ((await kinds.json()) as { kind: string }[]).map((item) => item.kind);
    expect(kindList).not.toContain('isp');

    await page.goto('/isp-lines');
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Tình trạng hạn/ })).toHaveCount(0);

    await page.goto(`/isp-lines/${id}`);
    await expect(page.getByRole('button', { name: 'Sửa hồ sơ' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Gia hạn/ })).toHaveCount(0);
    await expect(page.getByText('Đang dùng', { exact: true })).toBeVisible();

    const terminate = await page.request.patch(`/api/v1/isp-lines/${id}`, {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { status: 'terminated' },
    });
    expect(terminate.status()).toBe(200);

    await page.reload();
    await expect(page.getByText('Thanh lý', { exact: true })).toBeVisible();
    await expect(
      page.getByText(new RegExp(`Thanh lý ngày .+ bởi ${E2E_SA.email.replace(/\./g, '\\.')}`)),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Thanh lý đường truyền' }),
    ).toBeVisible();
    await expect(page.getByText('trạng thái: Đang dùng → Thanh lý')).toBeVisible();
  });

  test('file scan hợp đồng đính kèm được vào đường truyền', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const created = await createLine(page, {
      code: `ISP-E2E-FILE-${stamp}`,
      provider: 'FPT',
    });

    await page.goto(`/isp-lines/${String(created.body.id)}`);
    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    await expect(page.getByText('Chưa có giấy tờ nào.')).toBeVisible();
    await expect(page.getByLabel('Chọn file để đính kèm')).toBeVisible();
  });

  /**
   * Sắp xếp PHẢI chạy ở server, không phải ở trang đang xem.
   *
   * Bài kiểm dựng 3 đường ISP rồi lọc còn đúng 3 dòng, bấm tiêu đề cột Nhà mạng và đọc lại
   * thứ tự. Quan trọng hơn: kiểm luôn cột Site KHÔNG có nút bấm — sắp theo site đòi join
   * sang bảng của module danh mục, vi phạm AD-2.
   */
  test('sắp xếp theo cột chạy ở server, cột Site không sắp được thì không có nút', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    for (const [suffix, provider] of [
      ['A', 'Zulu Telecom cuối bảng'],
      ['B', 'Alpha Telecom đầu bảng'],
      ['C', 'Mike Telecom giữa bảng'],
    ]) {
      const created = await createLine(page, {
        code: `ISP-SORT-E2E-${stamp}-${suffix}`,
        provider,
      });
      expect(created.status).toBe(201);
    }

    await page.goto('/isp-lines');
    await page
      .getByRole('searchbox', { name: 'Tìm theo mã, nhà mạng, IP WAN hoặc số hợp đồng' })
      .fill(`ISP-SORT-E2E-${stamp}`);
    await expect(page.getByRole('row')).toHaveCount(4); // 1 dòng tiêu đề + 3 đường

    const firstDataRow = () => page.getByRole('row').nth(1);
    await expect(firstDataRow()).toContainText(`ISP-SORT-E2E-${stamp}-A`); // mặc định: theo mã tăng

    // Phải bám vào ĐẦU BẢNG: ngoài kia thanh lọc cũng có nút tên "Site".
    const head = page.locator('thead');
    await head.getByRole('button', { name: 'Nhà mạng' }).click();
    await expect(firstDataRow()).toContainText('Alpha Telecom đầu bảng');

    await head.getByRole('button', { name: 'Nhà mạng' }).click();
    await expect(firstDataRow()).toContainText('Zulu Telecom cuối bảng');

    // Cột dựa vào danh mục: hiện chữ, nhưng KHÔNG phải nút bấm được.
    await expect(head.getByRole('button', { name: 'Site' })).toHaveCount(0);
  });
});
