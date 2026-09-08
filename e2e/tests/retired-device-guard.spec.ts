import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetIpam,
  resetIsp,
  resetSoftware,
  resetUsers,
  writeHeaders,
} from './helpers';

/**
 * Rà soát 07/09, mục "miền nghiệp vụ": thiết bị `retired` có **8 điểm ghi đang hở**.
 *
 * Máy đã thanh lý — đã ra khỏi công ty, đã ký biên bản — vẫn nhận được license, vẫn được cấp
 * IP, vẫn dựng được rule NAT trỏ vào nó, vẫn cắm được đường truyền. Không cửa nào hỏi một câu.
 *
 * Nguyên nhân gốc mà rà soát chỉ đúng: `devices.api.exists()` chỉ trả lời "có hàng này trong
 * bảng không". Module khác muốn hỏi "máy này còn dùng được không" thì KHÔNG CÓ CỬA NÀO — và
 * AD-2 cấm chúng tự query bảng `device`. Nên bốn nơi đều hỏi câu duy nhất hỏi được, rồi đi
 * tiếp. Hàng rào không thiếu vì ai đó lười; nó thiếu vì cái api không cho hỏi.
 *
 * Bài này canh cả bốn cửa cùng lúc: sửa một cửa mà quên ba cửa kia là đúng mẫu N1 đã lặp ba
 * lần trong repo này.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetIpam();
  resetSoftware();
  resetIsp();
  resetCatalog();
});

async function typeIdFor(page: Page, name: string): Promise<string> {
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const found = catalog.deviceTypes.find((t) => t.name === name) ?? catalog.deviceTypes[0];
  return found.id;
}

async function makeDevice(page: Page, code: string, typeName: string): Promise<string> {
  const res = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { code, name: `May ${code}`, deviceTypeId: await typeIdFor(page, typeName) },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { device: { id: string } }).device.id;
}

async function retire(page: Page, deviceId: string): Promise<void> {
  const res = await page.request.patch(`/api/v1/devices/${deviceId}/status`, {
    headers: await writeHeaders(page),
    data: { status: 'retired' },
  });
  expect(res.status(), 'thanh lý máy phải chạy được — đó là việc bình thường').toBeLessThan(300);
}

/** Mọi cửa phải trả CÙNG mã lỗi: người dùng gặp một khái niệm, không phải bốn. */
const CODE = 'DEVICE_RETIRED';

test.describe('Máy đã thanh lý không nhận thêm gì nữa', () => {
  test('không cấp được IP cho máy đã thanh lý', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const deviceId = await makeDevice(page, `PC-E2E-RT-${stamp}`, 'PC');

    const octet = Number(stamp) % 200;
    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers: await writeHeaders(page),
      data: { cidr: `172.17.${octet}.0/29`, name: `LAN E2E retired ${stamp}` },
    });
    expect(subnet.status()).toBe(201);
    const subnetId = ((await subnet.json()) as { id: string }).id;

    await retire(page, deviceId);

    const res = await page.request.post('/api/v1/ipam/addresses', {
      headers: await writeHeaders(page),
      data: { subnetId, address: `172.17.${octet}.5`, deviceId },
    });
    expect(res.status(), 'cấp IP cho máy đã ra khỏi công ty là ghi sai sổ').toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe(CODE);
  });

  test('không gán được license cho máy đã thanh lý', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const deviceId = await makeDevice(page, `PC-E2E-RTL-${stamp}`, 'PC');

    const sw = await page.request.post('/api/v1/software', {
      headers: await writeHeaders(page),
      data: {
        code: `SW-E2E-RT-${stamp}`,
        name: 'Office',
        kind: 'license',
        seatTotal: 10,
        startDate: '2025-01-01',
        endDate: '2027-12-31',
      },
    });
    expect(sw.status()).toBe(201);
    const softwareId = ((await sw.json()) as { id: string }).id;

    await retire(page, deviceId);

    const res = await page.request.post(`/api/v1/software/${softwareId}/assignments`, {
      headers: await writeHeaders(page),
      data: { deviceId },
    });
    expect(res.status(), 'máy đã thanh lý không được ăn thêm một ghế license nào').toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe(CODE);
  });

  test('không dựng được rule NAT trên router đã thanh lý', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const routerId = await makeDevice(page, `RT-E2E-RT-${stamp}`, 'Router');

    await retire(page, routerId);

    const res = await page.request.post('/api/v1/ipam/nat', {
      headers: await writeHeaders(page),
      data: {
        deviceId: routerId,
        protocol: 'tcp',
        externalPorts: '9090',
        internalIp: '172.18.0.9',
        internalPort: 80,
        usedBy: 'May nao do',
        reason: 'Thu tren router da thanh ly',
      },
    });
    expect(res.status(), 'mở port trên một router đã tháo là mở port vào hư không').toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe(CODE);
  });

  test('không cắm được đường truyền vào máy đã thanh lý', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const deviceId = await makeDevice(page, `RT-E2E-RTI-${stamp}`, 'Router');

    await retire(page, deviceId);

    const res = await page.request.post('/api/v1/isp-lines', {
      headers: await writeHeaders(page),
      data: { code: `ISP-E2E-RT-${stamp}`, provider: 'Viettel', deviceId },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe(CODE);
  });

  /**
   * Vế đối chứng, và là vế giữ cho hàng rào không nuốt việc đúng: máy `broken` (hỏng, đang
   * chờ sửa) VẪN nhận được. Nó còn trong công ty, còn hồ sơ, còn giữ license và IP của nó —
   * chỉ `retired` mới là "đã ra khỏi sổ".
   *
   * Không có bài này thì một bản sửa cẩu thả chặn theo `status !== 'in_use'` cũng xanh, và
   * cả phòng IT hết cấp được IP cho máy đang sửa.
   */
  test('máy HỎNG thì vẫn cấp IP được — chỉ "đã thanh lý" mới bị chặn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const deviceId = await makeDevice(page, `PC-E2E-BRK-${stamp}`, 'PC');

    const octet = (Number(stamp) % 200) + 20;
    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers: await writeHeaders(page),
      data: { cidr: `172.19.${octet}.0/29`, name: `LAN E2E broken ${stamp}` },
    });
    const subnetId = ((await subnet.json()) as { id: string }).id;

    const changed = await page.request.patch(`/api/v1/devices/${deviceId}/status`, {
      headers: await writeHeaders(page),
      data: { status: 'broken' },
    });
    expect(changed.status()).toBeLessThan(300);

    const res = await page.request.post('/api/v1/ipam/addresses', {
      headers: await writeHeaders(page),
      data: { subnetId, address: `172.19.${octet}.5`, deviceId },
    });
    expect(res.status(), 'máy đang chờ sửa vẫn là máy của công ty').toBe(201);
  });

  /** Thiết bị không tồn tại vẫn phải là lỗi RIÊNG — hai chuyện khác nhau, hai câu khác nhau. */
  test('thiết bị ma vẫn báo "không tồn tại", không lẫn với "đã thanh lý"', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers: await writeHeaders(page),
      data: { cidr: `172.20.${Number(stamp) % 200}.0/29`, name: `LAN E2E ma ${stamp}` },
    });
    const subnetId = ((await subnet.json()) as { id: string }).id;

    const res = await page.request.post('/api/v1/ipam/addresses', {
      headers: await writeHeaders(page),
      data: {
        subnetId,
        address: `172.20.${Number(stamp) % 200}.5`,
        deviceId: '00000000-0000-0000-0000-000000000000',
      },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('DEVICE_NOT_FOUND');
  });
});

/**
 * BA CỬA GHI CÒN LẠI, phát hiện khi rà lại chính bản vá của mình.
 *
 * Rà soát 07/09 liệt kê TÁM điểm ghi hở với máy đã thanh lý. Đợt trước tôi đóng bốn cửa đi
 * xuyên module (cấp IP · tạo NAT · gán license · nối đường truyền) bằng `assertUsable`, rồi
 * báo là xong. Bốn cửa đó có điểm chung: chúng nằm ở module KHÁC, nên phải đi qua public api
 * của `devices` và tôi buộc phải nhìn thấy chúng.
 *
 * Ba cửa còn lại nằm NGAY TRONG module `devices` — sửa hồ sơ, import ghi đè, nối cổng — nên
 * chúng không đi qua cửa nào cả. Đúng mẫu N1 mà chính finding đó cảnh báo: dựng hàng rào ở
 * mấy cửa mình buộc phải bước qua, quên mấy cửa mở sẵn trong nhà.
 *
 * Hai cửa còn lại (đính kèm giấy tờ, cất secret) CỐ Ý để mở, và đó không phải sơ suất: biên
 * bản thanh lý được ký SAU khi thanh lý, nên nó phải đính được vào một hồ sơ đã khóa.
 */
test.describe('Ba cửa ghi trong chính module devices', () => {
  test('không SỬA được hồ sơ của máy đã thanh lý (UI khóa nút, API cũng phải khóa)', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const deviceId = await makeDevice(page, `PC-E2E-RTU-${stamp}`, 'PC');
    await retire(page, deviceId);

    const res = await page.request.patch(`/api/v1/devices/${deviceId}`, {
      headers: await writeHeaders(page),
      data: { name: 'Ten sua trom sau khi thanh ly' },
    });
    /*
     * Nút Sửa trên web đã `disabled` khi máy `retired`, nên lỗi này chỉ lộ ra khi ai đó gọi
     * thẳng API — mà đó chính là đường mà import, script dọn dữ liệu và mọi tích hợp tương lai
     * đi qua. Hàng rào ở UI là gợi ý, không phải hàng rào.
     */
    expect(res.status(), 'hồ sơ đã khóa thì phải khóa ở API, không chỉ ở nút bấm').toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe(CODE);
  });

  test('không NỐI/SỬA/GỠ được cổng của máy đã thanh lý', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const switchId = await makeDevice(page, `SW-E2E-RTP-${stamp}`, 'Switch');

    // Tạo một cổng khi máy còn sống, để có cái mà thử sửa/gỡ sau khi thanh lý.
    const created = await page.request.post(`/api/v1/devices/${switchId}/ports`, {
      headers: await writeHeaders(page),
      data: { portLabel: 'Gi0/1', usedBy: 'P. Ke toan' },
    });
    expect(created.status()).toBe(201);
    const portId = ((await created.json()) as { id: string }).id;

    await retire(page, switchId);
    const headers = await writeHeaders(page);

    const add = await page.request.post(`/api/v1/devices/${switchId}/ports`, {
      headers,
      data: { portLabel: 'Gi0/2' },
    });
    expect(add.status(), 'nối cổng mới vào máy đã thanh lý').toBe(400);
    expect(((await add.json()) as { code?: string }).code).toBe(CODE);

    const edit = await page.request.patch(`/api/v1/devices/${switchId}/ports/${portId}`, {
      headers,
      data: { usedBy: 'P. Nhan su' },
    });
    expect(edit.status(), 'sửa cổng của máy đã thanh lý').toBe(400);

    /*
     * Cả GỠ cũng chặn, có chủ ý: sơ đồ đấu nối của một máy đã thanh lý là bằng chứng "hồi đó
     * cắm vào đâu". Xóa nó sau khi máy đã đi là làm mất đúng thứ người ta cần khi truy vết.
     */
    const drop = await page.request.delete(`/api/v1/devices/${switchId}/ports/${portId}`, {
      headers,
    });
    expect(drop.status(), 'gỡ cổng của máy đã thanh lý').toBe(400);

    const ports = await page.request.get(`/api/v1/devices/${switchId}/ports`);
    expect(ports.status(), 'nhưng ĐỌC thì vẫn phải được').toBe(200);
  });

  test('IMPORT không ghi đè được lên máy đã thanh lý — báo ngay ở bảng đối chiếu', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `SW-E2E-RTI-${stamp}`;
    const deviceId = await makeDevice(page, code, 'Switch');
    await retire(page, deviceId);

    const file = await buildFile(join(tmpdir(), `rt-imp-${stamp}.xlsx`), [
      [code, 'Ten moi de len ho so da khoa', 'Switch', ''],
    ]);
    const headers = await writeHeaders(page);
    const upload = {
      file: { name: 'tb.xlsx', mimeType: 'application/octet-stream', buffer: readFileSync(file) },
    };

    // Vế 1: bảng đối chiếu phải chỉ ĐÍCH DANH dòng nào hỏng, không chỉ từ chối cả file.
    const preview = await page.request.post('/api/v1/devices/import/preview', {
      headers: { 'X-CSRF-Token': headers['X-CSRF-Token'], Origin: APP_ORIGIN },
      multipart: upload,
    });
    expect(preview.status()).toBeLessThan(300);
    const plan = (await preview.json()) as {
      summary: { error: number };
      rows: { action: string; message?: string }[];
    };
    expect(plan.summary.error).toBe(1);
    expect(plan.rows[0].message).toMatch(/thanh lý/i);

    // Vế 2: gửi thẳng lên /commit cũng phải chặn — không ai được đi vòng qua bảng đối chiếu.
    const commit = await page.request.post('/api/v1/devices/import/commit', {
      headers: { 'X-CSRF-Token': headers['X-CSRF-Token'], Origin: APP_ORIGIN },
      multipart: upload,
    });
    expect(commit.status()).toBe(400);

    const after = await page.request.get(`/api/v1/devices/${deviceId}`);
    expect(((await after.json()) as { name: string }).name).not.toContain('Ten moi');
  });

  /**
   * THANH LÝ BẰNG MỘT Ô EXCEL.
   *
   * Tìm ra khi đang vá cửa import, KHÔNG nằm trong danh sách của rà soát. Cột "Trạng thái" của
   * file mẫu nhận giá trị "Đã thanh lý", và import gọi thẳng `updateWithin` — nên nó đi vòng
   * qua TOÀN BỘ cái chốt dựng ở commit trước: không hỏi máy còn giữ IP/NAT/ghế license nào,
   * không dọn, không hỏi lại người dùng.
   *
   * Nói cách khác: hàng rào thanh lý chặn ở màn hình, còn Excel thì mở cửa sau.
   */
  test('IMPORT không tự thanh lý được máy — thanh lý là một chốt, không phải một ô Excel', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `SW-E2E-RTS-${stamp}`;
    const deviceId = await makeDevice(page, code, 'Switch');

    const file = await buildFile(join(tmpdir(), `rt-sts-${stamp}.xlsx`), [
      [code, 'Van ten cu', 'Switch', 'Đã thanh lý'],
    ]);
    const headers = await writeHeaders(page);
    const preview = await page.request.post('/api/v1/devices/import/preview', {
      headers: { 'X-CSRF-Token': headers['X-CSRF-Token'], Origin: APP_ORIGIN },
      multipart: {
        file: { name: 'tb.xlsx', mimeType: 'application/octet-stream', buffer: readFileSync(file) },
      },
    });
    const plan = (await preview.json()) as {
      summary: { error: number };
      rows: { message?: string }[];
    };
    expect(plan.summary.error, 'đổi trạng thái sang "đã thanh lý" bằng Excel phải bị chặn').toBe(1);
    expect(plan.rows[0].message).toMatch(/thanh lý/i);

    const still = await page.request.get(`/api/v1/devices/${deviceId}`);
    expect(((await still.json()) as { status: string }).status).not.toBe('retired');
  });

  /**
   * Vế đối chứng, và là vế tôi suýt quên: MỞ LẠI máy rồi thì mọi cửa phải mở lại theo.
   *
   * Thiếu bài này thì một bản vá thô bạo (chặn theo id, không theo trạng thái) vẫn xanh ở bốn
   * bài trên, và một cái máy lỡ bấm nhầm nút Thanh lý sẽ chết vĩnh viễn — đúng chế độ hỏng
   * tôi đã gây ra ở đợt C với đường sửa hồ sơ đường truyền.
   */
  test('mở lại máy thì sửa hồ sơ và nối cổng chạy lại bình thường', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const switchId = await makeDevice(page, `SW-E2E-RTB-${stamp}`, 'Switch');
    await retire(page, switchId);

    const reopen = await page.request.patch(`/api/v1/devices/${switchId}/status`, {
      headers: await writeHeaders(page),
      data: { status: 'in_use' },
    });
    expect(reopen.status()).toBeLessThan(300);

    const edited = await page.request.patch(`/api/v1/devices/${switchId}`, {
      headers: await writeHeaders(page),
      data: { name: 'Da mo lai va sua duoc' },
    });
    expect(edited.status(), 'máy mở lại rồi thì hồ sơ phải sửa được').toBeLessThan(300);

    const port = await page.request.post(`/api/v1/devices/${switchId}/ports`, {
      headers: await writeHeaders(page),
      data: { portLabel: 'Gi0/9' },
    });
    expect(port.status(), 'máy mở lại rồi thì cổng phải nối được').toBe(201);
  });
});

/** File .xlsx tối thiểu — cột Trạng thái có mặt để thử được đường "thanh lý bằng Excel". */
async function buildFile(path: string, rows: string[][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Thiết bị');
  sheet.addRow(['Mã thiết bị *', 'Tên thiết bị *', 'Loại *', 'Trạng thái']);
  for (const row of rows) sheet.addRow(row);
  await wb.xlsx.writeFile(path);
  return path;
}
