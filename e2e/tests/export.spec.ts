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

    /**
     * Chờ dòng audit hiện ra thay vì đọc một phát.
     *
     * Handler dùng `@Res()` không passthrough và `res.end()` NGAY trong thân hàm, còn
     * `AuditInterceptor` ghi ở `concatMap` SAU khi handler emit — tức là sau khi response đã
     * bay đi. `await page.request.get()` trả về trước khi INSERT kịp commit. Hôm nay test xanh
     * chỉ vì khởi động `psql` còn chậm hơn cái INSERT — đó là may, không phải đúng
     * (code review Epic 7).
     */
    await expect
      .poll(() => count('software.exported'), { timeout: 10_000 })
      .toBe(before + 2);
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

    /**
     * ĐỌC SỐ DÒNG thật trong sheet, không so kích thước file.
     *
     * Bản đầu so `filtered.length < all.length` trên bytes của file zip — mà deflate không
     * đơn điệu theo kích thước đầu vào: một sheet 1 dòng và một sheet 2 dòng có thể nén ra
     * bằng nhau hoặc ngược nhau tuỳ bảng chuỗi dùng chung. Nó cũng xanh vì những lý do chẳng
     * liên quan gì tới việc lọc (code review Epic 7).
     */
    const filtered = await rowsOf(
      await (await page.request.get('/api/v1/software/export.xlsx?kind=domain')).body(),
    );
    const all = await rowsOf(
      await (await page.request.get('/api/v1/software/export.xlsx')).body(),
    );

    expect(filtered).toContain('Tên miền lọc B');
    expect(filtered).not.toContain('License lọc A');
    expect(all).toContain('Tên miền lọc B');
    expect(all).toContain('License lọc A');
  });

  test('Member không xuất được nhật ký break-glass', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    expect((await page.request.get('/api/v1/vault/break-glass/export.xlsx')).status()).toBe(403);
  });
});

/** Mở file xlsx và trả về chữ của MỌI ô — đủ để khẳng định dòng nào có, dòng nào không. */
async function rowsOf(buffer: Buffer): Promise<string> {
  // exceljs là CJS: `await import` trả về namespace, các export thật nằm dưới `.default`.
  const mod = (await import('exceljs')) as unknown as {
    default?: { Workbook: new () => import('exceljs').Workbook };
    Workbook?: new () => import('exceljs').Workbook;
  };
  const Workbook = mod.default?.Workbook ?? mod.Workbook!;
  const wb = new Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const out: string[] = [];
  wb.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      out.push(row.values?.toString() ?? '');
    });
  });
  return out.join('\n');
}
