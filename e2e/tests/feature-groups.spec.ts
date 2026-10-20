import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  resetIso,
  resetUsers,
  rowAction,
  searchAndWaitForFilter,
  sql,
  writeHeaders,
} from './helpers';

/**
 * Q-31 — nhóm quyền của Thành viên. Ẩn = mất khỏi menu + URL gặp màn "không có quyền" + API của
 * mảng trả 403. Mọi nhóm tạo ra mang chữ "E2E" trong tên để `reset-e2e.mjs` dọn được.
 */
test.beforeEach(() => {
  resetUsers();
  resetIso();
});

const HIDDEN = 'Nhóm quyền của bạn không có mục này';

/** Nhóm + gán Member bằng SQL — cho các bài không kiểm chính màn Nhóm quyền. */
function memberInGroup(name: string, features: string[]): string {
  const id = randomUUID();
  sql(
    `INSERT INTO feature_group (id, name, features) VALUES ('${id}', '${name}', ARRAY[${features.map((f) => `'${f}'`).join(',')}]::text[])`,
  );
  sql(`UPDATE users SET feature_group_id = '${id}' WHERE email = '${E2E_MEMBER.email}'`);
  return id;
}

function memberId(): string {
  return sql(`SELECT id FROM users WHERE email = '${E2E_MEMBER.email}'`);
}

async function status(page: Page, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, data?: unknown) {
  const res =
    method === 'GET'
      ? await page.request.get(url)
      : await page.request.fetch(url, { method, headers: await writeHeaders(page), data });
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  return { status: res.status(), code: body.code, message: body.message };
}

test.describe('Nhóm quyền (Q-31)', () => {
  test('SA dựng nhóm "E2E Mạng" trên bảng tick rồi gán Member — Member chỉ còn mảng Mạng, không cần đăng nhập lại', async ({
    page,
    browser,
  }) => {
    // Member đăng nhập TRƯỚC, lúc còn đủ quyền — nhóm phải có hiệu lực ngay ở lần tải kế tiếp.
    const memberContext = await browser.newContext();
    const member = await memberContext.newPage();
    await firstLogin(member, E2E_MEMBER);

    await firstLogin(page, E2E_SA);
    await page.goto('/admin/feature-groups');
    await page.getByRole('button', { name: 'Thêm nhóm' }).click();
    const naming = page.getByRole('dialog', { name: 'Thêm nhóm quyền' });
    await naming.getByLabel('Tên nhóm').fill('E2E Mạng');
    await naming.getByRole('button', { name: 'Thêm nhóm' }).click();
    await expect(page.getByText('Đã thêm nhóm "E2E Mạng".')).toBeVisible();

    // Nhóm mới bắt đầu đủ bảy ô; bỏ hết trừ Mạng.
    for (const label of ['Tổng quan', 'Tài sản', 'Theo dõi backup · 0203', 'Sự cố · 0206', 'Theo dõi antivirus · 0208', 'Xin mở két']) {
      await page.getByRole('checkbox', { name: `E2E Mạng · ${label}` }).uncheck();
    }
    await expect(page.getByRole('checkbox', { name: 'E2E Mạng · Mạng' })).toBeChecked();
    await expect(page.getByText('Đã đổi 1 nhóm')).toBeVisible();
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('Đã lưu nhóm quyền.')).toBeVisible();
    expect(sql(`SELECT array_to_string(features, ',') FROM feature_group WHERE name = 'E2E Mạng'`)).toBe('network');

    await page.goto('/admin/accounts');
    await searchAndWaitForFilter(page, E2E_MEMBER.email);
    await rowAction(page, 'E2E Thành viên', 'Đổi nhóm quyền…');
    const assign = page.getByRole('dialog', { name: 'Nhóm quyền của E2E Thành viên' });
    await assign.getByLabel('Nhóm quyền').click();
    await page.getByRole('option', { name: 'E2E Mạng' }).click();
    await assign.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('Đã đổi nhóm quyền của E2E Thành viên.')).toBeVisible();
    await expect(page.getByRole('row', { name: /e2e-member@/ }).getByText('E2E Mạng')).toBeVisible();

    // Không có Tổng quan: vào / thì sang mục đầu tiên còn hiện.
    await member.goto('/');
    await expect(member).toHaveURL(/\/ip-addresses$/);
    await expect(member.getByRole('link', { name: 'Sổ NAT' })).toBeVisible();
    await expect(member.getByRole('link', { name: 'Thiết bị', exact: true })).toHaveCount(0);
    await expect(member.getByRole('link', { name: 'Bảng điều khiển' })).toHaveCount(0);

    // Gõ thẳng URL của mảng bị ẩn → màn "không có quyền", cả ở 390px.
    await member.goto('/devices');
    await expect(member.getByRole('heading', { name: HIDDEN })).toBeVisible();
    await member.setViewportSize({ width: 390, height: 844 });
    await expect(member.getByRole('heading', { name: HIDDEN })).toBeVisible();
    await memberContext.close();
  });

  test('đòn gọi thẳng API: mảng bị ẩn trả 403, tra cứu dùng chung vẫn chạy, Member không tự gỡ được nhóm', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    memberInGroup('E2E Chỉ mạng', ['network']);

    for (const url of ['/api/v1/software', '/api/v1/dashboard', '/api/v1/vault/break-glass/mine', '/api/v1/iso/backup/2021-03', '/api/v1/service-accounts']) {
      expect(await status(page, 'GET', url), url).toMatchObject({ status: 403, code: 'FEATURE_HIDDEN' });
    }
    // Ghi cũng bị chặn, không chỉ đọc.
    expect(await status(page, 'POST', '/api/v1/vault/break-glass', { subjectType: 'device', subjectId: memberId(), reason: 'E2E', hours: 1 })).toMatchObject({
      status: 403,
      code: 'FEATURE_HIDDEN',
    });

    // Vế đối chứng: mảng của nhóm và tra cứu dùng chung (ô chọn thiết bị khi cấp IP) vẫn 200.
    expect((await status(page, 'GET', '/api/v1/ipam/subnets')).status).toBe(200);
    expect((await status(page, 'GET', '/api/v1/devices?page=1&limit=5')).status).toBe(200);

    // Member tự đưa mình về "Đủ quyền" / đọc danh sách nhóm → vai chặn trước nhóm.
    expect(await status(page, 'PUT', `/api/v1/accounts/${memberId()}/feature-group`, { featureGroupId: null })).toMatchObject({ status: 403 });
    expect(await status(page, 'GET', '/api/v1/feature-groups')).toMatchObject({ status: 403 });
    expect(sql(`SELECT feature_group_id IS NOT NULL FROM users WHERE email = '${E2E_MEMBER.email}'`)).toBe('t');
  });

  test('người phụ trách phiếu phải thấy phiếu: bỏ tick 0203 khi Member đang phụ trách 0203 → 409 nêu tên', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const groupId = memberInGroup('E2E Có 0203', ['iso_0203', 'assets']);
    sql(`UPDATE iso_form_owner SET backup_user_id = '${memberId()}' WHERE form_type = '0203'`);

    const denied = await status(page, 'PATCH', `/api/v1/feature-groups/${groupId}`, { features: ['assets'] });
    expect(denied).toMatchObject({ status: 409, code: 'FEATURE_GROUP_HOLDER' });
    expect(denied.message).toContain('E2E Thành viên đang phụ trách phiếu 0203');
    expect(sql(`SELECT array_to_string(features, ',') FROM feature_group WHERE id = '${groupId}'`)).toBe('iso_0203,assets');

    // Chiều ngược lại: gán người phụ trách 0208 mà nhóm ẩn 0208 → 400.
    const hidden = await status(page, 'PUT', '/api/v1/iso/catalog/owners/0208', { primaryUserId: memberId(), backupUserId: null });
    expect(hidden).toMatchObject({ status: 400, code: 'ISO_OWNER_FEATURE_HIDDEN' });
  });
});
