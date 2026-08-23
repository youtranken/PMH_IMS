import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  resetAccessList,
  resetApprovals,
  resetDevices,
  resetIpam,
  resetSecrets,
  resetSoftware,
  resetUsers,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetApprovals();
  resetAccessList();
  resetSecrets();
  resetIpam();
  resetDevices();
  resetSoftware();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

const XLSX_MIME = 'spreadsheetml';

/** Story 7.2 — FR-028: xuất được ở mọi bảng; FR-026 vẫn nguyên: không export nào chứa secret. */
test.describe('Xuất Excel', () => {
  test('mọi màn danh sách đều xuất được file thật', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    // Dựng một ít dữ liệu để file không rỗng.
    await page.request.post('/api/v1/software', {
      headers,
      data: {
        code: `LIC-E2E-EXP-${stamp}`,
        name: 'License xuất thử',
        kind: 'license',
        endDate: '2027-01-31',
      },
    });
    await page.request.post('/api/v1/isp-lines', {
      headers,
      data: { code: `ISP-E2E-EXP-${stamp}`, provider: 'Viettel', hotline: '18008119' },
    });
    const octet = Number(stamp) % 200;
    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.16.${octet}.0/29`, name: `LAN xuất E2E ${stamp}` },
    });
    const subnetId = ((await subnet.json()) as { id: string }).id;
    await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId, address: `172.16.${octet}.1`, usedBy: 'Máy kế toán' },
    });

    for (const url of [
      '/api/v1/devices/export',
      '/api/v1/software/export.xlsx',
      '/api/v1/isp-lines/export.xlsx',
      '/api/v1/expiry/export.xlsx',
      `/api/v1/ipam/subnets/${subnetId}/export.xlsx`,
      '/api/v1/ipam/nat/export.xlsx',
      '/api/v1/vault/break-glass/export.xlsx',
    ]) {
      const res = await page.request.get(url);
      expect(res.status(), `phải xuất được: ${url}`).toBe(200);
      expect(res.headers()['content-type'], url).toContain(XLSX_MIME);
      // File xlsx thật luôn > 1KB (zip container + sheet). Vài chục byte = file hỏng.
      expect((await res.body()).length, url).toBeGreaterThan(1000);
    }
  });

  /**
   * FR-026 giữ nguyên hiệu lực ở Epic 7.
   *
   * Cất một secret có giá trị RẤT dễ nhận ra, rồi tải MỌI file xuất về và tìm chuỗi đó trong
   * bytes thô. File xlsx là zip nên chuỗi không nằm dạng phẳng — nhưng nếu có đường xuất nào
   * lỡ nhét plaintext vào tên cột hay ô ghi chú thì bài này vẫn bắt được ở dạng nén kém.
   * Quan trọng hơn: nó khẳng định KHÔNG TỒN TẠI endpoint xuất két.
   */
  test('FR-026: không đường xuất nào chứa secret, và không có đường xuất két', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: {
        code: `SW-E2E-EXP-${stamp}`,
        name: 'Switch xuất thử',
        deviceTypeId: catalog.deviceTypes[0].id,
      },
    });
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    const secretValue = `KHONGDUOCLOTRAFILE${stamp}`;
    await page.request.post('/api/v1/vault/secrets', {
      headers,
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: `admin web E2E ${stamp}`,
        value: secretValue,
      },
    });

    for (const url of [
      '/api/v1/devices/export',
      '/api/v1/software/export.xlsx',
      '/api/v1/isp-lines/export.xlsx',
      '/api/v1/expiry/export.xlsx',
      '/api/v1/ipam/nat/export.xlsx',
      '/api/v1/vault/break-glass/export.xlsx',
    ]) {
      const body = await (await page.request.get(url)).body();
      expect(body.toString('latin1').includes(secretValue), `lộ secret ở ${url}`).toBe(false);
    }

    // Và tuyệt đối không có đường xuất KÉT ở bất kỳ tên nào quen thuộc.
    for (const url of [
      '/api/v1/vault/secrets/export.xlsx',
      '/api/v1/vault/secrets/export',
      '/api/v1/vault/export.xlsx',
    ]) {
      expect((await page.request.get(url)).status(), url).not.toBe(200);
    }
  });

  /** AC 7.2: mỗi lần xuất ghi một dòng audit — "ai kéo cả kho ra file" phải trả lời được. */
  test('mỗi lần xuất ghi một dòng audit', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const { execSync } = await import('node:child_process');
    const { COMPOSE } = await import('./helpers');

    const count = (action: string) =>
      Number(
        execSync(
          `${COMPOSE} exec -T postgres psql -U ims -d ims -t -A -c "SELECT count(*) FROM audit_log WHERE action = '${action}' AND actor = '${E2E_SA.email}'"`,
          { cwd: '..', encoding: 'utf8' },
        ).trim(),
      );

    const before = count('software.exported');
    await page.request.get('/api/v1/software/export.xlsx');
    await page.request.get('/api/v1/software/export.xlsx');
    expect(count('software.exported')).toBe(before + 2);
  });

  test('xuất tôn trọng bộ lọc đang xem, không phải cả bảng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    await page.request.post('/api/v1/software', {
      headers,
      data: {
        code: `LIC-E2E-F1-${stamp}`,
        name: 'License lọc A',
        kind: 'license',
        endDate: '2027-01-31',
      },
    });
    await page.request.post('/api/v1/software', {
      headers,
      data: { code: `DOM-E2E-F2-${stamp}`, name: 'Tên miền lọc B', kind: 'domain', endDate: '2027-02-28' },
    });

    const filtered = await (
      await page.request.get('/api/v1/software/export.xlsx?kind=domain')
    ).body();
    const all = await (await page.request.get('/api/v1/software/export.xlsx')).body();

    // File lọc phải NHỎ HƠN file đầy đủ — cách kiểm rẻ nhất mà không phải mở zip ra đọc.
    expect(filtered.length).toBeLessThan(all.length);
  });

  test('Member không xuất được nhật ký break-glass', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    expect((await page.request.get('/api/v1/vault/break-glass/export.xlsx')).status()).toBe(403);
  });
});
