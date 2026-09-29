import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetIpam,
  resetSecrets,
  resetSoftware,
  resetUsers,
  sql,
  writeHeaders,
} from './helpers';

/**
 * Gắn thứ gì vào một chủ thể KHÔNG CÓ THẬT.
 *
 * ===== RỦI RO =====
 *
 * `FilesService.save` và `VaultService.create` nhận `ownerType`/`ownerId`. Nếu ghi thẳng mà
 * không kiểm chủ thể có tồn tại không, thì gửi `ownerType` bịa ra là file thành mồ côi, không
 * màn nào hiển thị và không ai dọn.
 *
 * Hậu quả cụ thể:
 *   - FILE: blob nằm trên đĩa vĩnh viễn, tính vào dung lượng, không màn nào hiện để mà xóa.
 *   - KÉT: bí mật cất vào đó KHÔNG AI MỞ LẠI ĐƯỢC, kể cả chính người vừa cất — mọi đường đọc
 *     đều đi qua `listFor(ownerType, ownerId)` từ một trang hồ sơ có thật.
 *
 * ===== VÌ SAO PHẢI THỬ ĐỦ SÁU LOẠI =====
 *
 * Hàng rào là một sổ đăng ký: mỗi module tự khai loại nó làm chủ. Thiếu MỘT registrar thì
 * đúng loại đó hở lại, và hở trong im lặng — không lỗi biên dịch, không test nào khác đỏ.
 * Đây là mẫu lỗi "dựng ở một cửa, quên cửa bên cạnh".
 * Nên bài này quét TOÀN BỘ `FILE_OWNER_TYPES`, không chọn vài loại tiêu biểu.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetIpam();
  resetSoftware();
  resetSecrets();
  resetCatalog();
});

/*
 * Uuid PHẢI hợp lệ theo `@IsUUID()` thì mới tới được hàng rào cần kiểm.
 *
 * Bản đầu dùng toàn số 0: nibble version bằng 0 nên class-validator từ chối ngay ở DTO, và
 * bài kiểm "đỏ" vì một lý do hoàn toàn khác — hàng rào chưa từng chạy. Version 4 + variant 8.
 */
const GHOST = '00000000-0000-4000-8000-0000000000ff';

const FILE_OWNER_TYPES = ['device', 'isp', 'software', 'service_account', 'subnet', 'nat_rule'];
const SECRET_OWNER_TYPES = ['device', 'software', 'service_account', 'isp'];

async function uploadTo(page: Page, ownerType: string, ownerId: string) {
  return page.request.post('/api/v1/files', {
    headers: { 'X-CSRF-Token': (await writeHeaders(page))['X-CSRF-Token'], Origin: APP_ORIGIN },
    multipart: {
      ownerType,
      ownerId,
      file: {
        name: 'giay-to.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\nthu gan vao chu the ma\n%%EOF\n'),
      },
    },
  });
}

test.describe('Chủ thể phải có thật mới gắn được đồ vào', () => {
  test('kho file: cả SÁU loại chủ thể đều từ chối ownerId bịa ra', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    const before = Number(sql('SELECT count(*) FROM file'));

    for (const ownerType of FILE_OWNER_TYPES) {
      const res = await uploadTo(page, ownerType, GHOST);
      expect(
        res.status(),
        `loại "${ownerType}" phải từ chối — thiếu một registrar là loại đó hở lại trong im lặng`,
      ).toBe(400);
      expect(((await res.json()) as { code?: string }).code, `mã lỗi của "${ownerType}"`).toBe(
        'OWNER_NOT_FOUND',
      );
    }

    /*
     * Không dòng file nào được sinh ra. Kiểm ở tầng DB chứ không tin mã trạng thái: hàng rào
     * đặt TRƯỚC `writeFile`, nên nếu nó bị đặt nhầm chỗ (sau khi ghi đĩa) thì API vẫn trả 400
     * mà blob đã nằm trên đĩa rồi — đúng cái file mồ côi cần tránh.
     */
    expect(Number(sql('SELECT count(*) FROM file')), 'không được đẻ hàng file nào').toBe(before);
  });

  test('két sắt: cả BỐN loại chủ thể đều từ chối ownerId bịa ra', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const before = Number(sql('SELECT count(*) FROM secret'));

    for (const ownerType of SECRET_OWNER_TYPES) {
      const res = await page.request.post('/api/v1/vault/secrets', {
        headers: await writeHeaders(page),
        data: {
          ownerType,
          ownerId: GHOST,
          kind: 'password',
          label: `E2E ma ${ownerType}`,
          value: 'Mat#Khau@2026',
        },
      });
      expect(res.status(), `két phải từ chối loại "${ownerType}"`).toBe(400);
      expect(((await res.json()) as { code?: string }).code).toBe('OWNER_NOT_FOUND');
    }

    expect(
      Number(sql('SELECT count(*) FROM secret')),
      'bí mật cất vào chủ thể ma là bí mật không ai mở lại được',
    ).toBe(before);
  });

  /**
   * Vế đối chứng — và là vế giữ cho hàng rào không nuốt việc đúng.
   *
   * Không có bài này thì một bản sửa cẩu thả (`assertExists` luôn ném) cũng xanh ở hai bài
   * trên, và cả phòng IT hết đính kèm được giấy tờ. Đúng chế độ hỏng tôi đã gây ra một lần ở
   * đợt A với ma trận quyền đính kèm.
   */
  test('chủ thể CÓ THẬT thì đính kèm và cất két vẫn chạy bình thường', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const device = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: {
        code: `PC-E2E-OE-${stamp}`,
        name: 'May that',
        deviceTypeId: catalog.deviceTypes.find((t) => t.name === 'PC')!.id,
      },
    });
    expect(device.status()).toBe(201);
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    expect((await uploadTo(page, 'device', deviceId)).status(), 'máy có thật thì phải đính được').toBe(
      201,
    );

    const secret = await page.request.post('/api/v1/vault/secrets', {
      headers: await writeHeaders(page),
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: `E2E that ${stamp}`,
        value: 'Mat#Khau@2026',
      },
    });
    expect(secret.status(), 'máy có thật thì phải cất két được').toBe(201);
  });

  /**
   * Máy ĐÃ THANH LÝ vẫn phải XEM và TẢI được giấy tờ.
   *
   * Ranh giới giữa hai câu hỏi khác nhau: "chủ thể có thật không" (sổ này) và "còn nhận thêm
   * được không" (`assertUsable`, commit trước). Gộp hai câu vào một sẽ chặn luôn việc đọc
   * biên bản thanh lý — mà đó đúng là thứ người ta cần đọc nhất sau khi máy đã đi.
   */
  test('máy đã thanh lý: giấy tờ cũ vẫn xem được — sổ này chỉ hỏi "có thật không"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const device = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: {
        code: `PC-E2E-OER-${stamp}`,
        name: 'May sap di',
        deviceTypeId: catalog.deviceTypes.find((t) => t.name === 'PC')!.id,
      },
    });
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;
    expect((await uploadTo(page, 'device', deviceId)).status()).toBe(201);

    const retired = await page.request.patch(`/api/v1/devices/${deviceId}/status`, {
      headers: await writeHeaders(page),
      data: { status: 'retired', cleanup: true },
    });
    expect(retired.status()).toBeLessThan(300);

    const listed = await page.request.get(
      `/api/v1/files?ownerType=device&ownerId=${deviceId}`,
    );
    expect(listed.status(), 'biên bản thanh lý là thứ cần đọc nhất SAU khi máy đã đi').toBe(200);
    expect((await listed.json()) as unknown[]).toHaveLength(1);
  });
});
