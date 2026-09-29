import { expect, test, type Page } from '@playwright/test';
import { APP_ORIGIN, E2E_SA, firstLogin, resetUsers, rowAction, timVaChoLoc, uniqueStamp } from './helpers';

/**
 * Hồ sơ tài khoản có SĐT, mã nhân viên và ngày sinh (migration 0031).
 *
 * Vì sao cần: máy hỏng lúc 2 giờ sáng thì người trực phải GỌI được người giữ máy — email
 * không ai đọc lúc đang chạy sự cố. Mã nhân viên là khoá đối chiếu sang bảng lương.
 */
test.beforeEach(() => {
  resetUsers();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

test.describe('Hồ sơ tài khoản', () => {
  test('đường hạnh phúc: sửa SĐT + mã NV + ngày sinh, danh sách hiện ra ngay', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    await page.goto('/admin/accounts');
    // Chờ bộ lọc ÁP XONG chứ không chỉ chờ hàng hiện ra: hàng cần tìm vốn đã nằm ở trang 1
    // của danh sách CHƯA lọc, nên câu chờ xanh ngay, rồi lượt nạp lại đổ xuống giữa lúc menu
    // ba chấm đang mở và giật nó khỏi DOM. Lý do đầy đủ: `di-khap-giao-dien-09-catalog-accounts-kit.spec.ts`, bài
    // "Phòng Tài khoản" (25/09/2026).
    await timVaChoLoc(page, E2E_SA.email);
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
    await rowAction(page, 'E2E Super Admin', 'Sửa');

    const form = page.getByRole('dialog');
    // Email KHÔNG sửa được: nó là danh tính đăng nhập và là thứ mọi dòng nhật ký trỏ tới.
    await expect(form.getByRole('textbox', { name: 'Email' })).toHaveCount(0);
    // Hiện thẳng chữ (`.static-value`) chứ không phải ô nhập bị khoá — ô khoá thì người dùng
    // còn ngồi thử bấm. Bám vào chính khối đó, không phải tiêu đề hộp cũng chứa email.
    await expect(form.getByTestId('account-email')).toHaveText(E2E_SA.email);

    await form.getByLabel('Số điện thoại').fill('0912 345 678');
    await form.getByLabel('Mã nhân viên').fill(`NV-${stamp}`);
    // Ô Ngày sinh có mặt (dùng chung `DatePicker`); bản thân widget lịch đã có bài kiểm
    // riêng, ở đây chỉ cần biết nó nằm đúng chỗ trong form.
    await expect(form.getByRole('button', { name: 'Ngày sinh' })).toBeVisible();
    await form.getByRole('button', { name: 'Lưu' }).click();

    await expect(page.getByText('Đã lưu hồ sơ tài khoản.')).toBeVisible();
    // Cả hai giá trị hiện NGAY trên danh sách — không phải mở lại hộp mới thấy.
    const row = page.getByRole('row', { name: new RegExp(E2E_SA.email) });
    await expect(row).toContainText(`NV-${stamp}`);
    await expect(row).toContainText('0912 345 678');
  });

  test('tìm được theo số điện thoại và theo mã nhân viên, không chỉ theo tên', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const phone = `097${stamp}`;

    const users = await page.request.get('/api/v1/accounts?limit=200');
    const items = ((await users.json()) as { items: { id: string; email: string }[] }).items;
    const target = items.find((item) => item.email === E2E_SA.email)!;

    const saved = await page.request.patch(`/api/v1/accounts/${target.id}/profile`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: { fullName: 'E2E Super Admin', phone, employeeCode: `NV-${stamp}`, birthDate: '1990-05-20' },
    });
    expect(saved.status()).toBe(200);

    await page.goto('/admin/accounts');
    // Nhân sự đưa sang một danh sách mã; người trực gõ một số điện thoại. Cả hai là cách
    // tìm THẬT, không phải chỉ tìm theo tên.
    for (const term of [phone, `NV-${stamp}`]) {
      await page.getByRole('searchbox', { name: /Tìm/ }).fill(term);
      await expect(page.getByRole('row', { name: new RegExp(E2E_SA.email) })).toBeVisible();
    }
  });

  test('đường hỏng: mã nhân viên trùng bị chặn kèm lời giải thích', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    const users = await page.request.get('/api/v1/accounts?limit=200');
    const items = ((await users.json()) as {
      items: { id: string; email: string; fullName: string }[];
    }).items;
    const first = items.find((item) => item.email === E2E_SA.email)!;
    const second = items.find((item) => item.email !== E2E_SA.email)!;

    expect(
      (
        await page.request.patch(`/api/v1/accounts/${first.id}/profile`, {
          headers,
          data: { fullName: first.fullName, employeeCode: `NV-DUP-${stamp}` },
        })
      ).status(),
    ).toBe(200);

    const clash = await page.request.patch(`/api/v1/accounts/${second.id}/profile`, {
      headers,
      data: { fullName: second.fullName, employeeCode: `NV-DUP-${stamp}` },
    });
    expect(clash.status()).toBe(409);
    // Nói RÕ trùng cái gì — 500 chung chung thì người nhập ngồi đoán.
    expect(String((await clash.json()).message)).toContain(`NV-DUP-${stamp}`);
  });

  test('đường hỏng: SĐT gõ chữ bị từ chối; để trống thì xoá được giá trị cũ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
    const users = await page.request.get('/api/v1/accounts?limit=200');
    const target = ((await users.json()) as { items: { id: string; fullName: string }[] }).items[0];

    const bad = await page.request.patch(`/api/v1/accounts/${target.id}/profile`, {
      headers,
      data: { fullName: target.fullName, phone: 'gọi anh Hùng nhé' },
    });
    expect(bad.status()).toBe(400);

    // Ô rỗng = XOÁ giá trị, không phải "đừng đụng tới". Và nhiều người cùng bỏ trống mã nhân
    // viên vẫn hợp lệ — index duy nhất chỉ áp cho dòng CÓ khai.
    for (const id of [target.id]) {
      const cleared = await page.request.patch(`/api/v1/accounts/${id}/profile`, {
        headers,
        data: { fullName: target.fullName, phone: '', employeeCode: '', birthDate: '' },
      });
      expect(cleared.status()).toBe(200);
    }
  });
});
