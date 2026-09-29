import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  COMPOSE,
  confirmAction,
  E2E_MEMBER,
  E2E_SA,
  clearMailbox,
  auditIpOf,
  countAudit,
  countAuditByActor,
  firstLogin,
  getConfig,
  lastAudit,
  mailBody,
  logout,
  resetDevices,
  waitForMail,
  resetSecrets,
  resetAccessList,
  resetUsers,
  rowAction,
  uniqueStamp,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetSecrets();
  resetDevices();
  /*
   * DỌN CẢ MA TRẬN QUYỀN.
   *
   * Hai bài của file này — "Member chưa được gán gì: đọc 403" và "khu Két sắt không lọt cho
   * Member ngoài ma trận quyền" — đều GIẢ ĐỊNH `E2E_MEMBER` không có phiếu quyền nào. Không
   * dọn ở đây thì điều đó chỉ đúng nhờ MAY: `vault-reveal.spec.ts` chạy ngay trước theo thứ tự
   * tên file, và `beforeEach` của nó có `resetAccessList()` nên dọn hộ.
   *
   * Nghĩa là chạy `vault.spec.ts` một mình bằng `--grep`, hoặc chỉ cần đổi thứ tự khai test
   * bên file kia, là hai bài này đỏ vì một lý do chẳng liên quan gì tới thứ chúng đang canh.
   * Một bài kiểm không được dựa vào hàng xóm để có điều kiện đầu vào của chính nó.
   */
  resetAccessList();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function createSwitch(page: Page, code: string): Promise<string> {
  const csrf = await csrfOf(page);
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const type = catalog.deviceTypes.find((t) => t.name === 'Switch')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
    data: { code, name: 'Switch cho két sắt', deviceTypeId: type.id, serial: `FOC-${code}` },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

/** FR-021 (cất secret mã hóa) + FR-026 (không có đường xuất hàng loạt). */
test.describe('Két sắt', () => {
  test('đường hạnh phúc: cất mật khẩu → hiện tên gọi, không hiện giá trị → xoay → thu hồi', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SW-E2E-VAULT-${stamp}`;
    const deviceId = await createSwitch(page, code);
    const label = `admin web E2E ${stamp}`;
    const secretValue = `Sup3r#Secret#${stamp}`;

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText('Két chưa có ngăn nào')).toBeVisible();

    // Thanh công cụ của tab: tiêu đề khu + số ngăn + nút cất cùng hàng (DEV-079).
    await expect(page.getByRole('heading', { name: 'Ngăn két' })).toBeVisible();
    await page.getByRole('button', { name: 'Cất mật khẩu/khóa' }).click();
    // Tiêu đề hộp nói cất vào MÁY NÀO (DEV-035).
    const form = page.getByRole('dialog', { name: `Cất mật khẩu/khóa — ${code}` });
    await expect(form).toBeVisible();
    await form.getByRole('textbox', { name: 'Tên gọi' }).fill(label);
    await form.getByRole('textbox', { name: 'Tên đăng nhập' }).fill('admin');
    await form.getByRole('textbox', { name: 'Giá trị', exact: true }).fill(secretValue);
    await form.getByRole('button', { name: 'Lưu' }).click();

    const row = page.getByRole('row', { name: new RegExp(label) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Mật khẩu', { exact: true })).toBeVisible();

    /**
     * Điểm kiểm quan trọng nhất của story: bảng CHỈ có metadata. Giá trị không có mặt ở đâu
     * trên trang cho tới khi bấm Xem và qua step-up (4.2) — kể cả trong DOM ẩn.
     */
    await expect(page.locator('body')).not.toContainText(secretValue);

    // Xoay: đổi giá trị, metadata giữ nguyên.
    await rowAction(page, label, 'Đổi giá trị');
    const rotate = page.getByRole('dialog');
    await rotate.getByRole('textbox', { name: 'Giá trị mới' }).fill(`${secretValue}-v2`);
    await rotate.getByRole('button', { name: 'Đổi giá trị' }).click();
    await expect(page.getByRole('row', { name: new RegExp(label) })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(secretValue);

    // Thu hồi = xóa mềm: biến khỏi danh sách.
    // Không hoàn tác được nên phải gõ lại đúng tên ngăn thì nút xác nhận mới bật.
    await rowAction(page, label, 'Xóa vĩnh viễn');
    await expect(
      page.getByTestId('dialog-footer').last().getByRole('button', { name: 'Xóa vĩnh viễn' }),
    ).toBeDisabled();
    await page.getByRole('dialog').last().getByRole('textbox').fill(label);
    await confirmAction(page, 'Xóa vĩnh viễn');
    await expect(page.getByRole('row', { name: new RegExp(label) })).toHaveCount(0);
  });

  test('đường hỏng: trùng tên gọi trên cùng thiết bị bị chặn, không phải 500', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createSwitch(page, `SW-E2E-DUP-${stamp}`);
    const csrf = await csrfOf(page);
    const body = {
      ownerType: 'device',
      ownerId: deviceId,
      kind: 'password',
      label: `SSH root E2E ${stamp}`,
      value: 'khong-quan-trong',
    };
    const headers = { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN };

    expect((await page.request.post('/api/v1/vault/secrets', { headers, data: body })).status())
      .toBe(201);

    const dup = await page.request.post('/api/v1/vault/secrets', { headers, data: body });
    expect(dup.status()).toBe(409);
    expect(await dup.json()).toMatchObject({ code: 'SECRET_LABEL_TAKEN' });
  });

  /**
   * FR-026 — không tồn tại đường xuất toàn bộ két ở MỌI quyền.
   *
   * Kiểm bằng chính con đường kẻ tấn công sẽ thử: bỏ bộ lọc chủ thể, đổi kiểu tham số, gọi
   * các tên route quen thuộc của những màn khác trong hệ thống (export.xlsx đã có ở thiết bị,
   * phần mềm, ISP — nên đó là chỗ dễ vô thức thêm vào nhất).
   */
  test('FR-026: không có đường nào lấy được nhiều hơn một chủ thể', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const deviceId = await createSwitch(page, `SW-E2E-FR026-${uniqueStamp()}`);

    for (const url of [
      '/api/v1/vault/secrets',
      '/api/v1/vault/secrets?ownerType=device',
      '/api/v1/vault/secrets?ownerId=' + deviceId,
      '/api/v1/vault/secrets/export.xlsx',
      '/api/v1/vault/secrets/all',
      '/api/v1/vault/export',
    ]) {
      const response = await page.request.get(url);
      expect(response.status(), `phải bị chặn: ${url}`).not.toBe(200);
    }
  });

  /**
   * Member THẤY tab Két sắt, vì quyền của họ nằm ở ma trận quyền xem (FR-023) chứ không suy ra
   * được từ vai. Nhưng chưa được gán gì thì vẫn là tầng CẤM — API
   * trả 403 và không có gì lọt ra.
   *
   * Cái KHÔNG đổi, và là phần đáng giữ nhất của bài kiểm này: Member không bao giờ GHI được
   * vào két, kể cả khi đã được cấp quyền xem.
   */
  test('Member chưa được gán gì: đọc 403, và không bao giờ ghi được vào két', async ({ page }) => {
    // Tạo thiết bị bằng SA trước, rồi đăng nhập lại bằng Member trên phiên sạch.
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createSwitch(page, `SW-E2E-MEM-${stamp}`);
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    const list = await page.request.get(
      `/api/v1/vault/secrets?ownerType=device&ownerId=${deviceId}`,
    );
    expect(list.status()).toBe(403);

    const create = await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: `member E2E ${stamp}`,
        value: 'x',
      },
    });
    expect(create.status()).toBe(403);

    await page.goto(`/devices/${deviceId}`);
    await expect(page.getByRole('tab', { name: 'Tổng quan' })).toBeVisible();
    // Tab CÓ hiện nhưng nội dung nói rõ là không có quyền — không phải bảng trống.
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText(/không có quyền/i)).toBeVisible();
  });

  /**
   * MỌI LƯỢT KHÔNG MỞ ĐƯỢC ĐỀU ĐỂ LẠI VẾT, VÀ ĐỦ NGƯỠNG THÌ BÁO CHO QUẢN TRỊ (0046).
   *
   * `assertCanReveal` ném trước khi `vault.reveal()` chạy, mà dòng audit của lượt thành công
   * nằm bên trong hàm đó — nên lượt bị chặn phải có dòng vết riêng, không thì "ai đã thử mà bị
   * chặn" không ở đâu cả. Đúng câu mà một hàng rào PHÁT HIỆN phải trả lời.
   *
   * Bài này đi trọn chuỗi: SÁU lượt bị từ chối → sáu dòng vết → đúng MỘT lá thư tới SA/Admin.
   *
   * Sáu chứ không phải ba, vì ba lượt chỉ kiểm được vế "đủ ngưỡng thì kêu". Lượt thứ tư, năm,
   * sáu đều đã VƯỢT ngưỡng — nếu thời gian nghỉ không làm việc thì đây là bốn lá thư. Mà vế đó
   * quan trọng ngang vế "có thư": không có nghỉ thì kẻ bắn liên tục làm ngập hộp thư quản trị,
   * thư thật chìm nghỉm, và chính cái cảnh báo trở thành công cụ tấn công.
   *
   * ===== VÌ SAO TÀI KHOẢN DÙNG MỘT LẦN, KHÔNG DÙNG `E2E_MEMBER` =====
   *
   * Bộ đếm nhìn theo NGƯỜI, trong một cửa sổ thời gian, và im một tiếng sau mỗi lá thư. Dùng
   * một tài khoản cố định thì lượt chạy đầu xanh, còn mọi lượt trong một tiếng kế tiếp ĐỎ — vì
   * thời gian nghỉ đang làm đúng việc của nó. Người đọc sẽ tưởng mình vừa làm hỏng cảnh báo.
   *
   * Và không có đường dọn: `audit_log` bị trigger chặn cả UPDATE lẫn DELETE ở tầng DB (0005,
   * NFR-03) — đúng như nó phải vậy. Một hàm trợ giúp tắt được trigger đó là khẩu súng đã lên
   * đạn nằm sẵn trong repo. Nên bài kiểm lấy lịch sử rỗng bằng cách đổi NGƯỜI, không bằng cách
   * xoá vết.
   */
  test('bị từ chối mở két: ghi vết mỗi lượt, vượt ngưỡng vẫn chỉ đúng một thư cảnh báo', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createSwitch(page, `SW-E2E-PROBE-${stamp}`);
    const created = await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: `ngăn bị dò E2E ${stamp}`,
        value: 'khong-ai-doc-duoc',
      },
    });
    expect(created.status()).toBe(201);
    const secretId = ((await created.json()) as { id: string }).id;

    // Người dò dẫm dùng một lần: tiền tố `e2e-tao-moi-` là mẫu `resetUsers()` nhìn vào để dọn.
    const hired = await page.request.post('/api/v1/accounts', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: {
        email: `e2e-tao-moi-do-ket-${stamp}@pmh.com.vn`,
        fullName: 'Nguoi do ket E2E',
        role: 'member',
      },
    });
    expect(hired.status(), 'tạo tài khoản dò dẫm dùng một lần').toBe(201);
    const prober = {
      email: `e2e-tao-moi-do-ket-${stamp}@pmh.com.vn`,
      password: ((await hired.json()) as { temporaryPassword: string }).temporaryPassword,
    };

    await logout(page);
    await clearMailbox();
    await firstLogin(page, prober);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    /*
     * NGƯỠNG ĐỌC TỪ `system_config`, KHÔNG GÕ CỨNG (AD-11).
     *
     * Chốt cứng "sáu lượt" là ngầm giả định ngưỡng là 3. Hai chuyện hỏng theo:
     * đổi `secret.probe_alert_threshold` — đúng đường lùi mà migration 0046 quảng cáo — là
     * bài này đỏ vì một lý do chẳng liên quan; còn HẠ ngưỡng xuống 1 thì bài vẫn xanh mà
     * thời gian nghỉ không còn được kiểm đúng cảnh (phải vượt ngưỡng rồi mới nói được là
     * "nhiều lượt chỉ một thư").
     *
     * Bài `vault-reveal.spec.ts` đã đọc `secretRevealSeconds` từ `/auth/me` theo đúng lối
     * này; đây chỉ là áp cùng một luật cho con số thứ hai.
     */
    const nguong = Number(getConfig('secret.probe_alert_threshold'));
    expect(nguong, 'ngưỡng phải là một số dương thì bài này mới có nghĩa').toBeGreaterThan(0);
    const soLuot = nguong * 2;

    // Member ngoài ma trận quyền: bắn gấp đôi ngưỡng, tất cả phải bị chặn.
    for (let i = 0; i < soLuot; i += 1) {
      const denied = await page.request.post(`/api/v1/vault/secrets/${secretId}/reveal`, {
        headers,
      });
      expect(denied.status(), 'Member ngoài ma trận quyền không được mở').toBe(403);
      expect(
        await denied.text(),
        'và thân phản hồi tuyệt đối không mang theo giá trị',
      ).not.toContain('khong-ai-doc-duoc');
    }

    expect(
      countAudit('vault.secret.reveal_denied', secretId),
      'mỗi lượt bị chặn phải là MỘT dòng vết — đây là thứ trước đây không có',
    ).toBe(soLuot);

    const row = lastAudit('vault.secret.reveal_denied', secretId);
    expect(row?.actor, 'vết phải mang tên người vừa thử').toBe(prober.email);
    expect(
      row?.detail ?? '',
      'vết KHÔNG được mang nhãn ngăn — nhãn chính là thứ người này không được phép biết',
    ).not.toContain('ngăn bị dò');

    const mails = await waitForMail('lượt thất bại quanh két');
    expect(mails.length, 'đủ ngưỡng thì phải có thư cảnh báo ĐI THẬT').toBeGreaterThanOrEqual(1);

    /*
     * "ĐÚNG MỘT LẦN" hỏi DB, không hỏi hộp thư — xem chú thích của `countAuditByActor`.
     * `expect(mails.length).toBe(1)` là một cuộc đua: `waitForMail` trả
     * về ngay lượt poll đầu thấy ≥1 lá, nên bỏ trọn khối thời-gian-nghỉ vẫn XANH — bốn lá
     * thừa còn đang trên đường qua outbox → BullMQ → SMTP.
     */
    expect(
      countAuditByActor('security.probe.alerted', prober.email),
      `${soLuot} lượt thất bại chỉ được sinh ĐÚNG MỘT lượt cảnh báo: thời gian nghỉ là thứ ` +
        'chặn chính cảnh báo trở thành công cụ làm ngập hộp thư quản trị',
    ).toBe(1);

    /*
     * DÒNG AN NINH PHẢI GHI LẠI DÒ TỪ MÁY NÀO.
     *
     * Đây là lý do DUY NHẤT `security-probe.service.ts` dùng `audit.appendWithin` thay vì
     * `tx.insert` gõ tay: chỉ đường kia mới chạy `toRow()`, nơi `ip` lấy từ `currentRequestIp()`.
     * Insert thẳng thì `ip` LUÔN NULL — một khoảng trống NFR-03 ở dòng an ninh đáng giá nhất.
     * Bài `api/test/security-probe-race.spec.ts` KHÔNG đọc được cột ấy vì nó chạy ngoài ngữ
     * cảnh request.
     * Ở đây thì có: lượt gọi đi qua controller thật, trong một request thật.
     */
    expect(
      { ipCuaDongCanhBao: auditIpOf('security.probe.alerted', prober.email) === '' },
      'dòng `security.probe.alerted` phải mang IP — "dò từ máy nào" là câu điều tra viên hỏi đầu tiên',
    ).toEqual({ ipCuaDongCanhBao: false });

    const body = await mailBody(mails[0].ID);
    expect(body, 'thư phải nói ai đang dò').toContain(prober.email);
    /* Chân thư phải nói ĐÚNG thời gian nghỉ đang cấu hình, không phải một con số viết cứng.
       `?? 60` cũ trùng đúng giá trị seed nên không bài nào phân biệt được hai nguồn — bỏ hẳn
       trường khỏi payload thì chuỗi vẫn y nguyên. Đọc từ `system_config` rồi so. */
    expect(body, 'chân thư phải nói đúng thời gian nghỉ đang đặt').toContain(
      `im trong ${getConfig('secret.probe_cooldown_minutes')} phút`,
    );
    expect(
      body,
      'nhưng KHÔNG được nói ngăn nào bị thử — thư là thứ dễ chuyển tiếp nhất trong hệ thống',
    ).not.toContain('ngăn bị dò');
  });

  /**
   * MÁY ĐÃ THANH LÝ THÌ KÉT ĐÓNG BĂNG — ở MỌI CỬA, không chỉ trên một màn.
   *
   * Luật này phải nằm ở API, không chỉ ở một biểu thức trong JSX của trang chi tiết thiết bị
   * (`canEdit={canVaultWrite && !retired}`): màn `/vault` không xét trạng thái hồ sơ, nên gác ở
   * một màn thì đi đường `/vault` là cất được mật khẩu mới vào một cái máy đã thanh lý. Người
   * dùng học một luật ở màn này rồi phát hiện màn kia không theo.
   *
   * Thu hồi cũng bị chặn, và đó là chủ ý: cùng luật với phần còn lại của hồ sơ ("mở lại mới
   * sửa được"). Vế cuối của bài kiểm chính là đường thoát — mở lại thì làm được ngay.
   */
  test('máy đã thanh lý: mọi cửa ghi vào két đều bị chặn, mở lại thì làm được', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createSwitch(page, `SW-E2E-FROZEN-${stamp}`);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    const created = await page.request.post('/api/v1/vault/secrets', {
      headers,
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: `ngăn trước thanh lý E2E ${stamp}`,
        value: 'truoc-khi-thanh-ly',
      },
    });
    expect(created.status(), 'vế đối chứng: máy còn dùng thì cất được').toBe(201);
    const secretId = ((await created.json()) as { id: string }).id;

    const retire = await page.request.patch(`/api/v1/devices/${deviceId}/status`, {
      headers,
      data: { status: 'retired' },
    });
    expect(retire.status()).toBe(200);

    /* BỐN cửa ghi, không phải một: hàng rào dựng ở cửa được nhớ tới và thiếu ở những cửa
       tương đương ngay bên cạnh là lớp lỗi đã lặp lại nhiều lần trong repo này. */
    const cuaGhi: { ten: string; goi: () => Promise<{ status: () => number }> }[] = [
      {
        ten: 'cất ngăn mới',
        goi: () =>
          page.request.post('/api/v1/vault/secrets', {
            headers,
            data: {
              ownerType: 'device',
              ownerId: deviceId,
              kind: 'password',
              label: `ngăn sau thanh lý E2E ${stamp}`,
              value: 'sau-khi-thanh-ly',
            },
          }),
      },
      {
        ten: 'sửa metadata',
        goi: () =>
          page.request.patch(`/api/v1/vault/secrets/${secretId}`, {
            headers,
            data: { label: `đổi nhãn E2E ${stamp}` },
          }),
      },
      {
        ten: 'xoay giá trị',
        goi: () =>
          page.request.post(`/api/v1/vault/secrets/${secretId}/rotate`, {
            headers,
            data: { value: 'gia-tri-moi' },
          }),
      },
      {
        ten: 'thu hồi',
        goi: () => page.request.delete(`/api/v1/vault/secrets/${secretId}`, { headers }),
      },
    ];

    for (const cua of cuaGhi) {
      const res = await cua.goi();
      expect(res.status(), `cửa "${cua.ten}" phải bị chặn khi máy đã thanh lý`).toBe(400);
    }

    // ĐỌC thì vẫn được: biên bản thanh lý là thứ người ta cần tra nhất sau khi máy đã đi.
    const list = await page.request.get(
      `/api/v1/vault/secrets?ownerType=device&ownerId=${deviceId}`,
    );
    expect(list.status(), 'thanh lý là đóng băng chứ không phải giấu đi').toBe(200);

    // Mở lại máy thì mọi thứ làm được ngay — đó là đường thoát, và nó phải có thật.
    const reopen = await page.request.patch(`/api/v1/devices/${deviceId}/status`, {
      headers,
      data: { status: 'in_use' },
    });
    expect(reopen.status()).toBe(200);
    const again = await page.request.patch(`/api/v1/vault/secrets/${secretId}`, {
      headers,
      data: { label: `đổi được rồi E2E ${stamp}` },
    });
    expect(again.status(), 'mở lại hồ sơ thì két phải sửa được ngay').toBe(200);
  });

  /**
   * SỬA METADATA CỦA MỘT NGĂN — `PATCH /vault/secrets/:id`.
   *
   * Đây là bài kiểm duy nhất của cửa này ở mọi tầng. Thiếu nó thì `updateMeta` có thể trả về
   * mà không ghi gì, hoặc bỏ luôn dòng audit trong transaction, và không có gì báo cho tới khi
   * người dùng kêu.
   *
   * Bài này khẳng định ba vế: metadata đổi thật, GIÁ TRỊ không hề đổi theo (sửa nhãn không
   * được đụng tới mật khẩu), và có đúng một dòng audit mang tên người sửa.
   */
  test('sửa metadata của ngăn: đổi nhãn không đụng tới giá trị, và có vết', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createSwitch(page, `SW-E2E-EDIT-${stamp}`);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
    const value = `Gia#Tri#${stamp}`;

    const created = await page.request.post('/api/v1/vault/secrets', {
      headers,
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: `nhãn cũ E2E ${stamp}`,
        username: 'root',
        value,
      },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    const patched = await page.request.patch(`/api/v1/vault/secrets/${id}`, {
      headers,
      data: { label: `nhãn mới E2E ${stamp}`, username: 'admin' },
    });
    expect(patched.status()).toBe(200);

    const list = (await (
      await page.request.get(`/api/v1/vault/secrets?ownerType=device&ownerId=${deviceId}`)
    ).json()) as { id: string; label: string; username: string | null }[];
    const row = list.find((item) => item.id === id);
    expect(row?.label).toBe(`nhãn mới E2E ${stamp}`);
    expect(row?.username).toBe('admin');

    /* Sửa NHÃN không được đụng tới GIÁ TRỊ — hai thứ nằm hai cột, và một bản cài đặt lỡ tay
       mã lại giá trị bằng chuỗi rỗng sẽ không làm khẳng định nào ở trên đỏ. */
    const opened = await page.request.post(`/api/v1/vault/secrets/${id}/reveal`, { headers });
    expect(opened.status()).toBe(200);
    expect(((await opened.json()) as { value: string }).value).toBe(value);

    const row2 = lastAudit('vault.secret.updated', id);
    expect(row2?.actor, 'lượt sửa phải để lại vết mang tên người sửa').toBe(E2E_SA.email);
  });

  /**
   * BÀI CANH MỘT LỖ RÒ ĐÃ BỊT.
   *
   * `GET /devices/:id/panels` mở cho vai `member` (hồ sơ máy là việc hàng ngày), nhưng khu
   * "Két sắt" trong đó bày NHÃN NGĂN và TÊN ĐĂNG NHẬP. Provider chỉ nhận `deviceId` thì không
   * có gì để hỏi ma trận quyền: cùng một dữ liệu mà `GET /vault/secrets`
   * trả 403 thì cửa này trả 200. Lặp `GET /devices` rồi gọi panel từng máy là lấy được bản đồ
   * "công ty giữ bí mật ở đâu" — đúng thứ `/vault/owners` khoá lại cho SA/Admin — và đường
   * này KHÔNG ghi một dòng audit nào.
   *
   * Vế SA ở đầu bài là vế đối chứng, không phải thừa: thiếu nó thì bài vẫn xanh trọn vẹn kể cả
   * khi ai đó gỡ hẳn khu Két sắt khỏi trang thiết bị.
   */
  test('khu "Két sắt" trên trang thiết bị không lọt cho Member ngoài ma trận quyền', async ({
    page,
  }) => {
    // Hai luồng đăng nhập lần đầu (SA rồi Member) trong cùng một bài.
    test.setTimeout(150_000);

    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createSwitch(page, `SW-E2E-PANEL-${stamp}`);
    const label = `admin web E2E ${stamp}`;
    const username = `root-E2E-${stamp}`;

    const created = await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label,
        username,
        value: 'mat-khau-that',
      },
    });
    expect(created.status(), 'không cất được secret thì phần còn lại của bài vô nghĩa').toBe(201);

    const panelsOf = async () =>
      (await (await page.request.get(`/api/v1/devices/${deviceId}/panels`)).json()) as {
        key: string;
      }[];

    const asSa = await panelsOf();
    expect(
      asSa.map((panel) => panel.key),
      'SA phải thấy khu Két sắt — không có vế này thì bài xanh cả khi khu đó bị gỡ hẳn',
    ).toContain('vault');

    await logout(page);
    await firstLogin(page, E2E_MEMBER);

    const asMember = await panelsOf();
    expect(
      asMember.map((panel) => panel.key),
      'Member ngoài ma trận quyền KHÔNG được nhận khu Két sắt qua cửa /panels',
    ).not.toContain('vault');
    expect(
      JSON.stringify(asMember),
      'và không mẩu metadata nào của ngăn được lọt ra: nhãn là bản đồ, tên đăng nhập là một nửa thông tin đăng nhập',
    ).not.toContain(username);
  });

  test('DB chỉ chứa rác: giá trị cất vào không tìm thấy ở dạng chữ trong bảng secret', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createSwitch(page, `SW-E2E-CIPHER-${stamp}`);
    const plaintext = `Plain#Text#${stamp}`;

    const created = await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: `cipher E2E ${stamp}`,
        value: plaintext,
      },
    });
    expect(created.status()).toBe(201);

    // Bản ghi trả về không được mang theo bất kỳ cột mã hóa nào, và tuyệt đối không có giá trị.
    const meta = (await created.json()) as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(
      [
        'createdAt',
        'createdBy',
        'id',
        'kind',
        'label',
        'note',
        'ownerId',
        'ownerType',
        'updatedAt',
        'username',
        // Mốc đổi giá trị gần nhất (VLT-054) — chỉ là ngày giờ + người, không mang giá trị.
        'valueChangedAt',
        'valueChangedBy',
      ].sort(),
    );

    /**
     * Đọc THẲNG bảng trong Postgres — đây mới là "DB bị trộm thì chỉ là rác" của AC. Kiểm
     * qua API thì hiển nhiên không thấy plaintext (API có bao giờ trả đâu), nên chẳng chứng
     * minh được gì. Ở đây soi cả năm cột envelope dưới dạng text.
     */
    const dump = execSync(
      `${COMPOSE} exec -T postgres psql -U ims -d ims -t -A -c ` +
        `"SELECT encode(value_ct,'escape') || encode(value_iv,'escape') || encode(value_tag,'escape') ` +
        `|| encode(dek_wrapped,'escape') || coalesce(note,'') || label ` +
        `FROM secret WHERE id = '${(meta as { id: string }).id}'"`,
      { cwd: '..', encoding: 'utf8' },
    );
    expect(dump.trim()).not.toBe('');
    expect(dump).not.toContain(plaintext);
  });
});
