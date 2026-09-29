import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  expireStepUp,
  firstLogin,
  freshTotpCode,
  resetDevices,
  resetSecrets,
  resetUsers,
  rowAction,
  sql,
  writeHeaders,
  uniqueStamp,
} from './helpers';

/**
 * Luồng NGƯỜI DÙNG THẬT của C2: hết grace → bấm Xoay → hộp hỏi mã 6 số hiện ra → gõ mã →
 * việc vừa bấm tự chạy lại và xong.
 *
 * ===== VÌ SAO BÀI NÀY PHẢI TỒN TẠI RIÊNG =====
 *
 * `vault-write-guard.spec.ts` gọi API trực tiếp, nên nó chỉ chứng minh SERVER biết từ chối.
 * Nó KHÔNG chạm tới `useStepUpRetry` — cái hook tôi vừa dựng để web hỏi mã rồi thử lại. Và
 * `vault.spec.ts` thì xoay/thu hồi ngay sau khi đăng nhập, tức luôn còn trong grace 10 phút,
 * nên hộp hỏi mã ở đó không bao giờ hiện.
 *
 * Nghĩa là trước bài này, nhánh `STEPUP_REQUIRED → hộp hỏi mã → thử lại` của web CHƯA TỪNG
 * chạy một lần nào. Siết API mà không có nó thì người dùng gặp 403 không lối thoát — đúng
 * cái rủi ro đã khiến tôi hoãn C2 một lần.
 */

test.beforeEach(() => {
  resetUsers();
  resetSecrets();
  resetDevices();
});

test.describe('C2 — luồng hỏi mã trên giao diện', () => {
  test('hết grace: bấm Xoay → hiện hộp nhập mã → gõ mã → xoay xong', async ({ page }) => {
    // Bốn lượt chờ chu kỳ TOTP 30 giây có thể dồn lại; trần mặc định 60 giây là quá sát.
    test.setTimeout(150_000);

    const totpSecret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const typeId = catalog.deviceTypes.find((t) => t.name === 'Switch')!.id;

    const device = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: {
        code: `SW-E2E-SUUI-${stamp}`,
        name: 'Switch step-up UI',
        deviceTypeId: typeId,
      },
    });
    expect(device.status()).toBe(201);
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    const label = `admin web E2E ${stamp}`;
    const created = await page.request.post('/api/v1/vault/secrets', {
      headers: await writeHeaders(page),
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label,
        value: `Cu#${stamp}`,
      },
    });
    expect(created.status(), 'cất lúc còn trong grace phải chạy được bình thường').toBe(201);

    // Hết grace — từ đây mọi đường GHI vào két phải hỏi mã.
    expireStepUp(E2E_SA.email);

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    // `.first()`: nhãn hiện ở nhiều ô trong bảng (tên gọi + nhãn phụ), strict mode của
    // Playwright coi đó là lỗi. Ở đây chỉ cần biết ngăn đã xuất hiện.
    await expect(page.getByRole('cell', { name: label }).first()).toBeVisible();

    await rowAction(page, label, 'Đổi giá trị');
    // Khoanh theo tiêu đề: khi hộp hỏi mã mở ra thì có HAI dialog, `getByRole('dialog')`
    // trần sẽ mơ hồ.
    const rotateDialog = page.getByRole('dialog').filter({ hasText: 'Đổi giá trị' });
    await rotateDialog.getByRole('textbox', { name: 'Giá trị mới' }).fill(`Moi#${stamp}`);
    await rotateDialog.getByRole('button', { name: 'Đổi giá trị' }).click();

    /*
     * ĐÂY là điều bài này sinh ra để chứng minh: hộp hỏi mã phải hiện, chứ không phải một
     * toast lỗi 401 rồi bỏ mặc người dùng.
     */
    await expect(
      page.getByRole('heading', { name: 'Xác nhận danh tính' }),
      'hết grace mà bấm Xoay thì phải được hỏi mã, không phải báo lỗi rồi thôi',
    ).toBeVisible();

    await page.getByLabel('Mã xác thực').fill(await freshTotpCode(totpSecret));

    /*
     * Gõ mã xong thì việc vừa bấm TỰ CHẠY LẠI — người dùng không phải bấm Xoay lần nữa.
     * Hộp xoay đóng lại là dấu hiệu `onSaved()` đã chạy, tức lượt thử lại thành công.
     */
    await expect(page.getByRole('heading', { name: 'Xác nhận danh tính' })).toBeHidden();
    await expect(rotateDialog).toBeHidden();

    // Và bí mật vẫn còn đúng một ngăn với nhãn cũ: xoay đổi GIÁ TRỊ, không đổi metadata.
    const after = await page.request.get(
      `/api/v1/vault/secrets?ownerType=device&ownerId=${deviceId}`,
    );
    expect(after.status()).toBe(200);
    const rows = (await after.json()) as { label: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe(label);
  });

  test('đóng hộp hỏi mã = hủy: không ghi gì, và nút không kẹt ở trạng thái đang ghi', async ({
    page,
  }) => {
    test.setTimeout(150_000);

    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const typeId = catalog.deviceTypes.find((t) => t.name === 'Switch')!.id;
    const device = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: { code: `SW-E2E-SUX-${stamp}`, name: 'Switch huy', deviceTypeId: typeId },
    });
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    const label = `admin web E2E ${stamp}`;
    const created = await page.request.post('/api/v1/vault/secrets', {
      headers: await writeHeaders(page),
      data: { ownerType: 'device', ownerId: deviceId, kind: 'password', label, value: `Cu#${stamp}` },
    });
    expect(created.status()).toBe(201);
    const secretId = ((await created.json()) as { id: string }).id;

    /*
     * ẢNH CHỤP TRƯỚC — không có nó thì nửa "KHÔNG GHI GÌ" của tên bài không có gì đỡ.
     *
     * Ciphertext là thứ đo đúng nhất: xoay bí mật sinh DEK mới và IV mới cho mỗi lần seal
     * (`envelope.service.ts`), nên `value_ct` đổi kể cả khi người dùng gõ lại ĐÚNG giá trị cũ.
     * `updated_at` một mình thì không đủ — một bản cài đặt quên đụng cột đó vẫn qua.
     */
    const beforeCt = sql(`SELECT md5(value_ct::text) FROM secret WHERE id = '${secretId}'`);
    const beforeUpdatedAt = sql(`SELECT updated_at::text FROM secret WHERE id = '${secretId}'`);

    expireStepUp(E2E_SA.email);

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await rowAction(page, label, 'Đổi giá trị');
    // Khoanh theo tiêu đề: khi hộp hỏi mã mở ra thì có HAI dialog, `getByRole('dialog')`
    // trần sẽ mơ hồ.
    const rotateDialog = page.getByRole('dialog').filter({ hasText: 'Đổi giá trị' });
    await rotateDialog.getByRole('textbox', { name: 'Giá trị mới' }).fill(`Moi#${stamp}`);
    await rotateDialog.getByRole('button', { name: 'Đổi giá trị' }).click();
    await expect(page.getByRole('heading', { name: 'Xác nhận danh tính' })).toBeVisible();

    /*
     * Bấm Hủy CỦA HỘP HỎI MÃ — phải khoanh vùng, không dùng `.first()`.
     *
     * Lúc này CẢ HAI hộp đang mở và cả hai đều có nút "Hủy" (`common.cancel`): hộp Xoay và
     * hộp hỏi mã. `.first()` bắt trúng nút Hủy của hộp XOAY — nút đang nằm dưới lớp modal
     * (`pointer-events: none`), nên hoặc là treo tới hết 150 giây, hoặc nếu lọt thì nó đóng
     * hộp Xoay và tháo luôn hộp hỏi mã, khiến khẳng định cuối chạy trên một node đã chết.
     * Kiểu nào cũng là bài kiểm nói dối.
     */
    const stepUpDialog = page
      .getByRole('dialog')
      .filter({ hasText: 'Xác nhận danh tính' });
    await stepUpDialog.getByRole('button', { name: 'Hủy' }).click();
    await expect(page.getByRole('heading', { name: 'Xác nhận danh tính' })).toBeHidden();

    /*
     * Nút Xoay phải BẬT LẠI. Đây là chỗ dễ hỏng nhất của `useStepUpRetry`: nếu lời hứa bị treo
     * thay vì `reject` khi đóng hộp, `finally { setBusy(false) }` của nơi gọi không bao giờ
     * chạy và nút kẹt ở "Đang xử lý…" vĩnh viễn — người dùng phải tải lại trang.
     */
    const rotateButton = rotateDialog.getByRole('button', { name: 'Đổi giá trị' });
    await expect(rotateButton, 'hủy gõ mã thì nút Xoay phải bấm lại được').toBeEnabled();

    /*
     * VÀ KHÔNG GHI GÌ — nửa còn lại của tên bài.
     *
     * Các khẳng định phía trên chỉ nói về hiển thị và nút bấm. Nếu lượt xoay VẪN lọt xuống
     * server sau khi người dùng hủy — đúng chế độ hỏng mà `useStepUpRetry` sinh ra để chặn —
     * thì chúng vẫn xanh; thiếu vế này thì bài mang tên một lời hứa bảo mật mà không có dòng
     * nào đỡ lời hứa đó.
     *
     * Kiểm ở DB chứ không qua API: đường đọc giá trị đòi step-up, mà bài này vừa cố tình để
     * step-up hết hạn.
     */
    expect(
      sql(`SELECT md5(value_ct::text) FROM secret WHERE id = '${secretId}'`),
      'hủy gõ mã mà ciphertext đổi = lượt xoay đã lọt xuống server, mật khẩu cũ đã chết',
    ).toBe(beforeCt);
    expect(
      sql(`SELECT updated_at::text FROM secret WHERE id = '${secretId}'`),
      'không ghi gì thì không có gì để đóng dấu thời gian',
    ).toBe(beforeUpdatedAt);
    expect(
      sql(
        `SELECT count(*)::text FROM audit_log WHERE action = 'vault.secret.rotated' AND object_id = '${secretId}'`,
      ),
      'nhật ký cũng không được có dòng nào cho một lượt xoay đã hủy',
    ).toBe('0');
  });
});
