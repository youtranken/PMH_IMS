import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  mailBody,
  mailedApprovalCode,
  mailpitMessages,
  requestBreakGlass,
  resetAccessList,
  resetApprovals,
  resetDevices,
  resetSecrets,
  resetUsers,
  sql,
  stepUpViaApi,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Q-30 — "Xin mở két" duyệt bằng mã 6 số gửi qua mail, trên stack thật (api + worker + Mailpit).
 *
 * Mỗi bài dựng lại một đòn: đoán mã, người khác nhập mã hộ, dùng mã đã quá 10 phút, dùng mã cũ
 * sau khi gửi lại, gửi lại quá 3 lần. Đường hạnh phúc (nhập mã trên giao diện rồi xem) nằm ở
 * `break-glass.spec.ts` và `break-glass-session.spec.ts`.
 */

test.beforeEach(() => {
  resetUsers();
  resetApprovals();
  resetAccessList();
  resetSecrets();
  resetDevices();
});

/** SA dựng thiết bị + gán Member tầng "cần duyệt"; Member đăng nhập ở ngữ cảnh riêng và xin. */
async function pending(page: Page, browser: Browser) {
  await stepUpViaApi(page, await firstLogin(page, E2E_SA));
  const headers = await writeHeaders(page);
  const catalog = (await (await page.request.get('/api/v1/catalog', { headers })).json()) as {
    deviceTypes: { id: string; name: string }[];
  };
  const typeId = (catalog.deviceTypes.find((t) => t.name === 'Switch') ?? catalog.deviceTypes[0]).id;
  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: `SW-E2E-BGMA-${uniqueStamp()}`, name: 'Switch mã duyệt', deviceTypeId: typeId },
  });
  expect(device.status()).toBe(201);
  const deviceId = ((await device.json()) as { device: { id: string } }).device.id;
  const access = await page.request.post('/api/v1/vault/access', {
    headers,
    data: { memberEmail: E2E_MEMBER.email, scopeType: 'device_type', scopeRef: typeId, tier: 'needs_approval' },
  });
  expect(access.status()).toBeLessThan(300);

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const member = await ctx.newPage();
  await stepUpViaApi(member, await firstLogin(member, E2E_MEMBER));
  const id = await requestBreakGlass(member, { ownerId: deviceId, reason: 'E2E sự cố switch lõi' });
  return { id, member, ctx };
}

async function submit(page: Page, id: string, code: string) {
  const res = await page.request.post(`/api/v1/vault/break-glass/${id}/code`, {
    headers: await writeHeaders(page),
    data: { code },
  });
  return { status: res.status(), code: ((await res.json()) as { code?: string }).code ?? 'OK' };
}

const wrongOf = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');
const stateOf = (id: string) => sql(`SELECT state FROM approval WHERE id = '${id}'`);

test.describe('Duyệt mở két bằng mã — các đòn phải bị chặn (Q-30)', () => {
  test.setTimeout(180_000);

  test('thư mang mã chỉ tới người được chọn; tiêu đề không có mã', async ({ page, browser }) => {
    const { id, ctx } = await pending(page, browser);
    const code = await mailedApprovalCode(id);
    const mails = [];
    for (const mail of await mailpitMessages()) {
      if ((await mailBody(mail.ID)).includes(`/approvals/${id}`)) mails.push(mail);
    }
    expect(mails.map((m) => m.To.map((t) => t.Address))).toEqual([[E2E_SA.email]]);
    expect(mails[0].Subject).not.toContain(code);
    expect(sql(`SELECT code_hash FROM break_glass_code WHERE approval_id = '${id}'`)).not.toContain(code);
    await ctx.close();
  });

  test('đòn đoán mã: sai 4 lần còn chờ, sai lần 5 thì yêu cầu bị hủy, mã đúng cũng hết dùng', async ({
    page,
    browser,
  }) => {
    const { id, member, ctx } = await pending(page, browser);
    const code = await mailedApprovalCode(id);
    for (let i = 1; i <= 4; i += 1) {
      expect(await submit(member, id, wrongOf(code))).toEqual({ status: 400, code: 'BREAK_GLASS_CODE_WRONG' });
    }
    expect(stateOf(id)).toBe('pending');
    expect(await submit(member, id, wrongOf(code))).toEqual({ status: 409, code: 'BREAK_GLASS_CODE_LOCKED' });
    expect(stateOf(id)).toBe('cancelled');
    expect((await submit(member, id, code)).status).toBe(409);
    expect(
      sql(`SELECT count(*) FROM audit_log WHERE action = 'break_glass.code_failed' AND object_id = '${id}'`),
    ).toBe('5');
    await ctx.close();
  });

  test('đòn người khác nhập mã hộ: SA có mã trong tay cũng không duyệt được phiếu của người khác', async ({
    page,
    browser,
  }) => {
    const { id, member, ctx } = await pending(page, browser);
    const code = await mailedApprovalCode(id);
    expect(await submit(page, id, code)).toEqual({ status: 404, code: 'APPROVAL_NOT_FOUND' });
    expect(stateOf(id)).toBe('pending');
    // Vế đối chứng: đúng người xin với đúng mã thì được.
    expect(await submit(member, id, code)).toEqual({ status: 201, code: 'OK' });
    expect(sql(`SELECT state || '|' || decided_by FROM approval WHERE id = '${id}'`)).toBe(`approved|${E2E_SA.email}`);
    await ctx.close();
  });

  test('đòn dùng mã quá 10 phút, rồi dùng mã cũ sau khi gửi lại', async ({ page, browser }) => {
    const { id, member, ctx } = await pending(page, browser);
    const first = await mailedApprovalCode(id);
    sql(`UPDATE break_glass_code SET code_expires_at = now() - interval '1 second' WHERE approval_id = '${id}'`);
    expect(await submit(member, id, first)).toEqual({ status: 409, code: 'BREAK_GLASS_CODE_EXPIRED' });
    expect(stateOf(id)).toBe('pending');

    const resent = await member.request.post(`/api/v1/vault/break-glass/${id}/resend-code`, {
      headers: await writeHeaders(member),
    });
    expect(resent.status()).toBe(201);
    let second = '';
    await expect
      .poll(async () => {
        second = await mailedApprovalCode(id);
        return second !== first;
      })
      .toBe(true);
    // Mã của lượt cũ chết hẳn, kể cả khi nó chưa từng được dùng.
    expect((await submit(member, id, first)).status).not.toBe(201);
    expect(await submit(member, id, second)).toEqual({ status: 201, code: 'OK' });
    await ctx.close();
  });

  test('đòn gửi lại mã vô hạn: tối đa 3 lần, lần thứ 4 bị từ chối', async ({ page, browser }) => {
    const { id, member, ctx } = await pending(page, browser);
    const headers = await writeHeaders(member);
    for (let n = 1; n <= 3; n += 1) {
      const ok = await member.request.post(`/api/v1/vault/break-glass/${id}/resend-code`, { headers });
      expect(ok.status(), `lần gửi lại thứ ${n}`).toBe(201);
    }
    const over = await member.request.post(`/api/v1/vault/break-glass/${id}/resend-code`, { headers });
    expect(over.status()).toBe(409);
    expect(((await over.json()) as { code: string }).code).toBe('BREAK_GLASS_CODE_RESEND_LIMIT');
    expect(sql(`SELECT send_no FROM break_glass_code WHERE approval_id = '${id}'`)).toBe('4');
    await ctx.close();
  });
});
