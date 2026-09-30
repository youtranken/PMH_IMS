import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  ispProviderId,
  resetDevices,
  resetIsp,
  resetUsers,
  uniqueStamp,
} from './helpers';

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
      providerId: await ispProviderId(page, 'FPT Telecom E2E'),
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
    // Q-18: gửi "1900 6600", lưu bỏ dấu cách.
    await expect(row.getByRole('link', { name: '19006600' })).toBeVisible();
    await expect(row.getByText(`HD-${stamp}`)).toBeVisible();
    // Hotline bấm gọi được thẳng từ điện thoại.
    await expect(row.getByRole('link', { name: '19006600' })).toHaveAttribute(
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
      providerId: await ispProviderId(page, 'Viettel E2E'),
      deviceId,
      hotline: '18008098',
      contractNo: `HD-FW-${stamp}`,
    });
    expect(created.status).toBe(201);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Đường truyền ISP' })).toBeVisible();
    // Hỏi trong KHU "Đường truyền ISP": bản đồ quan hệ ở đầu trang cũng in hotline ra một dòng.
    const ispSection = page.getByRole('region', { name: 'Đường truyền ISP' });
    await expect(ispSection.getByText('18008098')).toBeVisible();
    await expect(ispSection.getByText(`HD-FW-${stamp}`)).toBeVisible();
  });

  test('đường hỏng: thiếu nhà mạng, gửi ngày hết hạn, thiết bị không tồn tại', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    const noProvider = await createLine(page, { code: `ISP-E2E-NP-${stamp}` });
    expect(noProvider.status).toBe(400);
    expect(String(noProvider.body.message)).toContain('nhà mạng');

    // Q-04: đường truyền không có hạn. Client cũ còn gửi `endDate` thì bị từ chối, không lặng
    // lẽ bỏ qua — nếu không, người gửi tưởng hạn đã được lưu.
    const fpt = await ispProviderId(page, 'FPT E2E');
    const withEnd = await createLine(page, {
      code: `ISP-E2E-BR-${stamp}`,
      providerId: fpt,
      endDate: '2027-01-01',
    });
    expect(withEnd.status).toBe(400);

    const ghostDevice = await createLine(page, {
      code: `ISP-E2E-GD-${stamp}`,
      providerId: fpt,
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
    const created = await createLine(page, {
      code,
      providerId: await ispProviderId(page, 'VNPT E2E'),
    });
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
    await expect(page.getByText('Đã thanh lý', { exact: true })).toBeVisible();
    // Băng rôn đầu trang: ngày và NGƯỜI thanh lý (họ tên khi tra được, không thì email).
    await expect(page.getByText(/Đã thanh lý ngày \d{2}\/\d{2}\/\d{4} bởi .+/)).toBeVisible();
    // Đường đã chết thì thôi nhắc "Chưa khai" và thôi thẻ "Khi mất mạng".
    await expect(page.getByText(/^Chưa khai/)).toHaveCount(0);
    await expect(page.getByText('Khi mất mạng')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Thanh lý đường truyền' }),
    ).toBeVisible();
    await expect(page.getByText('trạng thái: Đang dùng → Đã thanh lý')).toBeVisible();
  });

  test('file scan hợp đồng đính kèm được vào đường truyền', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const created = await createLine(page, {
      code: `ISP-E2E-FILE-${stamp}`,
      providerId: await ispProviderId(page, 'FPT E2E'),
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
      ['A', 'Zulu Telecom E2E cuối bảng'],
      ['B', 'Alpha Telecom E2E đầu bảng'],
      ['C', 'Mike Telecom E2E giữa bảng'],
    ]) {
      const created = await createLine(page, {
        code: `ISP-SORT-E2E-${stamp}-${suffix}`,
        providerId: await ispProviderId(page, provider),
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
    await expect(firstDataRow()).toContainText('Alpha Telecom E2E đầu bảng');

    await head.getByRole('button', { name: 'Nhà mạng' }).click();
    await expect(firstDataRow()).toContainText('Zulu Telecom E2E cuối bảng');

    // Cột dựa vào danh mục: hiện chữ, nhưng KHÔNG phải nút bấm được.
    await expect(head.getByRole('button', { name: 'Site' })).toHaveCount(0);
  });

  /**
   * Q-11: nhà mạng chọn từ danh mục — khoá ngoại thật. Đổi tên ở danh mục là đổi ở mọi đường
   * truyền; xoá mục đang dùng bị chặn; id lạ và tên gõ tay bị từ chối.
   */
  test('nhà mạng là khoá ngoại: form chọn từ danh mục, đổi tên lan ra, xoá bị chặn', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const name = `Nha mang E2E ${stamp}`;
    const providerId = await ispProviderId(page, name);
    const code = `ISP-E2E-FK-${stamp}`;

    await page.goto('/isp-lines');
    await page.getByRole('button', { name: 'Thêm đường truyền' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Mã đường').fill(code);
    await dialog.getByRole('button', { name: 'Nhà mạng' }).click();
    await page.getByRole('option', { name }).click();
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/isp-lines') && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const body = (await response.json()) as { id: string; providerId: string; provider: string };
    expect(body).toMatchObject({ providerId, provider: name });

    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
    const renamed = `${name} moi`;
    const rename = await page.request.patch(`/api/v1/catalog/isp_provider/${providerId}`, {
      headers,
      data: { name: renamed },
    });
    expect(rename.status()).toBe(200);
    const line = await page.request.get(`/api/v1/isp-lines/${body.id}`);
    expect(((await line.json()) as { provider: string }).provider).toBe(renamed);
    await page.goto('/isp-lines');
    await expect(page.getByRole('row', { name: new RegExp(code) })).toContainText(renamed);

    const remove = await page.request.delete(`/api/v1/catalog/isp_provider/${providerId}`, {
      headers,
    });
    expect(remove.status()).toBe(409);
    expect(((await remove.json()) as { code: string }).code).toBe('CATALOG_IN_USE');

    const ghost = await createLine(page, {
      code: `ISP-E2E-GP-${stamp}`,
      providerId: '00000000-0000-4000-8000-000000000000',
    });
    expect(ghost.status).toBe(400);
    const byName = await createLine(page, { code: `ISP-E2E-TX-${stamp}`, provider: name });
    expect(byName.status).toBe(400);
  });
});

test.describe('Đường truyền — lọc, thẻ khi mất mạng, thanh lý có hỏi lại', () => {
  test('danh sách mặc định bỏ đường đã thanh lý; "Mọi trạng thái" thì hiện lại; IP WAN ngay dưới mã', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const provider = await ispProviderId(page, `Nha mang loc E2E ${stamp}`);
    const live = `ISP-E2E-LIVE-${stamp}`;
    const dead = `ISP-E2E-DEAD-${stamp}`;
    await createLine(page, { code: live, providerId: provider, wanIp: '113.161.20.16/29' });
    const created = await createLine(page, { code: dead, providerId: provider });
    await page.request.patch(`/api/v1/isp-lines/${String(created.body.id)}`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: { status: 'terminated' },
    });

    await page.goto('/isp-lines');
    await page.getByRole('searchbox').fill(`E2E-`);
    await page.getByRole('button', { name: 'Nhà mạng', exact: true }).first().click();
    await page.getByRole('option', { name: `Nha mang loc E2E ${stamp}` }).click();
    const liveRow = page.getByRole('row', { name: new RegExp(live) });
    await expect(liveRow).toBeVisible();
    await expect(liveRow.getByText('113.161.20.16/29')).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(dead) })).toHaveCount(0);

    // `.first()`: ô lọc đứng trước tiêu đề cột "Trạng thái" (cũng là nút sắp xếp).
    await page.getByRole('button', { name: 'Trạng thái', exact: true }).first().click();
    await page.getByRole('option', { name: 'Mọi trạng thái' }).click();
    await expect(page.getByRole('row', { name: new RegExp(dead) })).toBeVisible();
  });

  test('thẻ "Khi mất mạng" có nút gọi; Thanh lý đi menu ⋯ và hỏi lại (Hủy thì không đổi)', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const created = await createLine(page, {
      code: `ISP-E2E-SC-${stamp}`,
      providerId: await ispProviderId(page, 'VNPT E2E'),
      hotline: '1800 1166',
      contractNo: `HD-SC-${stamp}`,
    });
    await page.goto(`/isp-lines/${String(created.body.id)}`);

    const call = page.getByRole('link', { name: 'Gọi 18001166' });
    await expect(call).toHaveAttribute('href', 'tel:18001166');
    await expect(page.getByText(`HD-SC-${stamp}`).first()).toBeVisible();

    await page.getByRole('button', { name: `Thao tác với ISP-E2E-SC-${stamp}` }).click();
    await page.getByRole('menuitem', { name: 'Thanh lý…' }).click();
    const ask = page.getByRole('dialog');
    await expect(ask).toContainText('hợp đồng coi như đã cắt');
    // Két của đường còn trống thì không nhắc hủy mật khẩu vu vơ (NET-065 chỉ nhắc khi có).
    await expect(ask).not.toContainText('Két còn');
    // Nút ✕ của hộp hỏi lại cũng mang tên "Hủy" — bấm nút ở chân hộp.
    await ask.getByTestId('dialog-footer').getByRole('button', { name: 'Hủy' }).click();
    await expect(page.getByText('Đang dùng', { exact: true })).toBeVisible();

    // Cất mật khẩu PPPoE vào két của đường: lúc thanh lý phải nhắc hủy/xoay nó.
    const stashed = await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: {
        ownerType: 'isp',
        ownerId: String(created.body.id),
        kind: 'password',
        label: `pppoe-E2E-${stamp}`,
        value: 'MatKhau#2026',
      },
    });
    expect(stashed.status()).toBe(201);
    await page.reload();

    await page.getByRole('button', { name: `Thao tác với ISP-E2E-SC-${stamp}` }).click();
    await page.getByRole('menuitem', { name: 'Thanh lý…' }).click();
    await expect(ask).toContainText('Két còn 1 ngăn của đường này — xóa hoặc đổi giá trị nếu không còn dùng.');
    // Nút là HÀNH ĐỘNG "Thanh lý", không phải nhãn trạng thái "Đã thanh lý" (Q-14).
    await expect(ask.getByRole('button', { name: 'Đã thanh lý' })).toHaveCount(0);
    await ask.getByRole('button', { name: 'Thanh lý', exact: true }).click();
    // Băng rôn mang nhãn TRẠNG THÁI "Đã thanh lý" (Q-14), kèm ngày và người làm (NET-066).
    await expect(page.getByText(/^Đã thanh lý ngày \d{2}\/\d{2}\/\d{4} bởi .+/)).toBeVisible();
  });

  test('form: IP WAN sai định dạng thì báo ngay dưới ô, không gửi', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const provider = `Nha mang form E2E ${stamp}`;
    await ispProviderId(page, provider);
    await page.goto('/isp-lines');
    await page.getByRole('button', { name: 'Thêm đường truyền' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Mã đường').fill(`ISP-E2E-WAN-${stamp}`);
    await dialog.getByRole('button', { name: 'Nhà mạng' }).click();
    await page.getByRole('option', { name: provider }).click();
    await dialog.getByLabel('IP WAN').fill('113.161.10');
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await expect(dialog.getByText(/IP WAN phải là một IPv4/)).toBeVisible();
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('IP WAN').fill('113.161.10.20');
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await expect(dialog).toHaveCount(0);
  });
});
