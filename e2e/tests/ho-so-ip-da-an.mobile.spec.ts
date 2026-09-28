import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetIpam,
  resetUsers,
  rowAction,
  writeHeaders,
} from './helpers';

/**
 * UX-DR2 cho bề mặt MỚI của nhánh này: "hồ sơ IP đã ẩn / bật lại" trên màn chi tiết dải
 * (`web/src/features/ipam/subnet-detail.tsx`, +191 dòng, 09/09).
 *
 * Vì sao nó phải chạy ở 390px chứ không chỉ ở desktop: đường ẩn-rồi-bật-lại tồn tại đúng cho
 * cảnh "vừa gõ nhầm địa chỉ xong". Người gõ nhầm hay là người đang đứng ở tủ mạng với cái
 * điện thoại, không phải người ngồi trước màn 27 inch. Nếu ô tick hoặc menu ba chấm không bấm
 * được ở bề ngang đó thì cửa bật lại vẫn là cửa khóa, y như trước 09/09.
 *
 * Ba bài dưới đây tách theo ba câu hỏi khác nhau, cố ý: "bấm được không", "đọc được không",
 * "quay lại được không". Gộp làm một thì một lỗi bố cục và một lỗi nghiệp vụ cho ra cùng một
 * dòng đỏ.
 *
 * ===== MỘT NỢ ĐÃ BIẾT, GHI RA ĐÂY ĐỂ KHÔNG AI KIỂM NÓ THÀNH XANH GIẢ =====
 *
 * Lý do ẩn ở BẢNG chỉ nằm trong thuộc tính `title` của huy hiệu "Đã ẩn"
 * (`subnet-detail.tsx`: `<span className="badge muted" title={slot.voidReason ?? undefined}>`).
 * `title` cần trỏ chuột đứng yên mới hiện — ở 390px không có chuột, và bàn phím cũng không
 * tới được vì `span` không nhận focus. Nghĩa là ở đúng cái viewport mà tính năng này sinh ra
 * để phục vụ, lý do ẩn KHÔNG đọc được trên bảng.
 *
 * Nên bài số 3 bám vào chỗ đọc được THẬT — hộp "Bật lại", nơi lý do in ra thành chữ. Bài này
 * cố tình KHÔNG khẳng định "lý do vắng mặt trên bảng": khẳng định như thế là ghim cái nợ lại,
 * và ngày ai đó vá nó (đổi sang chữ thật, hoặc `<button>` mở popover) thì bài kiểm sẽ đỏ vì
 * một bản sửa ĐÚNG. Nợ ghi ở đây, không ghi vào assertion.
 */

test.beforeEach(() => {
  resetUsers();
  resetIpam();
});

const VOID_REASON = 'go nham dia chi cua may in ke toan';
const OWNER = 'Phòng Kế toán E2E 390';

/** Một dải /29 + một hồ sơ IP đã bị ẩn kèm lý do. Trả về mọi thứ bài kiểm cần bám vào. */
async function seedVoided(page: Page): Promise<{ subnetId: string; address: string }> {
  const headers = await writeHeaders(page);
  const stamp = Number(Date.now().toString().slice(-4)) % 200;
  const cidr = `10.${140 + (stamp % 40)}.${stamp}.0/29`;

  const subnet = await page.request.post('/api/v1/ipam/subnets', {
    headers,
    data: { name: `Dai an E2E 390 ${stamp}`, cidr },
  });
  expect(subnet.status()).toBeLessThan(300);
  const subnetId = ((await subnet.json()) as { id: string }).id;

  const address = cidr.replace('.0/29', '.5');
  const ip = await page.request.post('/api/v1/ipam/addresses', {
    headers,
    data: { subnetId, address, usedBy: OWNER },
  });
  expect(ip.status()).toBeLessThan(300);
  const ipId = ((await ip.json()) as { id: string }).id;

  const hidden = await page.request.delete(`/api/v1/ipam/addresses/${ipId}`, {
    headers,
    data: { reason: VOID_REASON },
  });
  expect(hidden.status()).toBeLessThan(300);

  return { subnetId, address };
}

test.describe('Hồ sơ IP đã ẩn ở 390px', () => {
  test('chip "Đã ẩn" bấm được, và hàng đã ẩn hiện ra', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const { subnetId, address } = await seedVoided(page);

    await page.goto(`/ip-addresses/${subnetId}`);

    const row = page.getByRole('row').filter({ hasText: address });
    await expect(row).toBeVisible();

    /*
     * VẾ TRƯỚC, và nó là vế giữ cho bài này không tự xanh: mặc định ô đã ẩn phải đọc ra là
     * TRỐNG. Thiếu dòng này thì một bản hỏng luôn luôn kèm `includeVoided=true` vẫn xanh ở
     * dưới, mà "ẩn = trả ô về trống" — toàn bộ ý nghĩa của việc ẩn — đã mất.
     */
    await expect(row).toContainText('Trống');
    await expect(row).not.toContainText(OWNER);

    const chip = page.getByRole('button', { name: /^Đã ẩn/ });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    await expect(row).toContainText('Đã ẩn');
    await expect(row).toContainText(OWNER);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('hàng đã ẩn đọc được ở dạng bảng xếp chồng — mỗi ô tự mang nhãn của nó', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const { subnetId, address } = await seedVoided(page);

    await page.goto(`/ip-addresses/${subnetId}`);
    await page.getByRole('button', { name: /^Đã ẩn/ }).click();

    const row = page.getByRole('row').filter({ hasText: address });
    await expect(row).toContainText('Đã ẩn');

    /*
     * Ở ≤960px `thead` bị `display: none` — nên KHÔNG còn dòng tiêu đề nào để mắt đối chiếu.
     * Đây vừa là bằng chứng bảng đã thật sự vào chế độ xếp chồng, vừa là lý do bài kiểm dưới
     * phải tồn tại: mất tiêu đề mà ô không tự mang nhãn thì hàng chỉ còn là một chuỗi giá trị
     * trần ("10.x.y.5 · Đã ẩn · — · Phòng Kế toán · —"), không ai đọc ra cột nào là cột nào.
     */
    await expect(page.getByRole('columnheader')).toHaveCount(0);

    /*
     * Nhãn nằm ở `td::before { content: attr(data-label) }`, tức nó KHÔNG có trong `textContent`
     * và không có locator nào với tới được. Đọc bằng `getComputedStyle(el, '::before')` là cách
     * duy nhất hỏi đúng câu "người dùng có thật sự nhìn thấy chữ 'Trạng thái' cạnh chữ 'Đã ẩn'
     * không". Phần tử được lấy bằng VAI (`cell`), không bằng tên class — CLAUDE.md.
     */
    const labels = await row
      .getByRole('cell')
      .evaluateAll((cells) =>
        cells.map((cell) => getComputedStyle(cell, '::before').content.replace(/^"|"$/g, '')),
      );

    /*
     * Ở ≤600px mỗi IP là thẻ hai dòng: dòng đầu (địa chỉ · huy hiệu · ⋯) tự nói nó là gì nên
     * không mang nhãn; các dòng sau (máy, người dùng, ngày) VẪN tự xưng tên — thiếu nhãn thì
     * "Phòng Kế toán" và mã máy không phân biệt được cái nào là cái nào. Ô trống ("—") ẩn
     * hẳn ở khổ này nên không có trong danh sách ô.
     */
    expect(labels, 'các dòng dữ liệu phụ phải tự xưng tên khi tiêu đề bảng biến mất').toEqual(
      expect.arrayContaining(['Người / bộ phận dùng']),
    );
    expect(labels[0], 'dòng địa chỉ không lặp nhãn "Địa chỉ" trước chính địa chỉ').toBe('none');

    // Và giá trị vẫn phải đọc được, không bị nhãn đẩy ra ngoài mép máy.
    await expect(row.getByRole('cell').filter({ hasText: address })).toBeVisible();
    await expect(row.getByRole('cell').filter({ hasText: OWNER })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('hộp "Bật lại" mở được ở 390px, đọc được lý do ẩn, và bật lại thật', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const { subnetId, address } = await seedVoided(page);

    await page.goto(`/ip-addresses/${subnetId}`);
    await page.getByRole('button', { name: /^Đã ẩn/ }).click();

    const row = page.getByRole('row').filter({ hasText: address });
    await expect(row).toContainText('Đã ẩn');

    // Menu ba chấm của đúng dòng đó — `rowAction` bám vào `aria-label` "Thao tác với <địa chỉ>".
    await rowAction(page, address, 'Bật lại');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(address);
    /*
     * ĐÂY là chỗ lý do ẩn thật sự đọc được ở điện thoại (xem chú thích đầu file về nợ `title`).
     * Hộp thoại phải nói CẢ hai vế: nhãn "Lý do đã ẩn:" lẫn nguyên văn lý do đã ghi — chỉ có
     * nhãn mà không có nội dung thì người bấm vẫn không biết mình đang bật lại cái gì.
     */
    await expect(dialog).toContainText('Lý do đã ẩn:');
    await expect(dialog.getByText(VOID_REASON)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await dialog.getByRole('button', { name: 'Bật lại' }).click();

    // Bật lại xong: hàng trở về danh sách thường, giữ nguyên chủ cũ, và ô hết là "Trống".
    await expect(page.getByText('Đã bật lại hồ sơ IP.')).toBeVisible();
    await expect(row).toContainText(OWNER);
    await expect(row).not.toContainText('Đã ẩn');
    await expect(row).not.toContainText('Trống');
  });
});
