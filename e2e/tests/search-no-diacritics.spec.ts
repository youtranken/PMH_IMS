import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  devicesPageButton,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetUsers,
  searchAndWaitForFilter,
  uniqueStamp,
} from './helpers';

/**
 * NGƯỜI VIỆT GÕ KHÔNG DẤU VẪN PHẢI TÌM RA.
 *
 * ===== LỖI ĐANG CANH =====
 *
 * `ILIKE` của Postgres không gấp dấu, còn `toLowerCase().includes()` bên trình duyệt cũng
 * không. Không gấp dấu thì gõ `Máy trạm` ra hàng nghìn dòng, gõ `may tram` ra **0 dòng** — và
 * màn hình trả lời "Không có thiết bị nào khớp bộ lọc", tức khẳng định một điều sai.
 *
 * ===== VÌ SAO PHẢI LÀ E2E, KHÔNG PHẢI BÀI ĐƠN VỊ =====
 *
 * Tìm không dấu chỉ đúng khi BA bản gấp dấu cùng nói một thứ: `ims_norm()` trong Postgres, `foldSearch`
 * bên api, `foldSearch` bên web. Ba bản ấy sống ở ba dự án không import được nhau. Bài đơn vị
 * canh từng bản so với `ops/search-fold-cases.json`; chỉ lượt E2E này mới hỏi được câu cuối
 * cùng — người gõ vào ô tìm thật thì có thấy hàng thật không.
 *
 * Bài chia ba, theo đúng ba ĐƯỜNG mã đi qua:
 *   1. cột sinh + chỉ mục GIN (`searchNormLike`)  → màn Thiết bị;
 *   2. `ims_norm()` tính tại chỗ (`imsNormLike`)  → màn Danh mục;
 *   3. gấp dấu Ở TRÌNH DUYỆT (`foldSearch`)      → Bảng lệnh Ctrl+K.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetCatalog();
});

/** Tạo một thiết bị mang tên TIẾNG VIỆT CÓ DẤU. Trả về mã đã dùng. */
async function createDeviceWithDiacritics(page: Page, stamp: string): Promise<string> {
  const code = `PC-E2E-VN-${stamp}`;
  await page.goto('/devices');
  await devicesPageButton(page, 'Thêm thiết bị').click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Mã thiết bị').fill(code);
  // Bốn chữ có dấu, bốn kiểu dấu khác nhau: thanh sắc, dấu mũ, dấu móc, dấu nặng.
  await form.getByLabel('Tên thiết bị').fill('Máy trạm kế toán Đường mới');
  await form.getByRole('button', { name: 'Loại' }).click();
  await page.getByRole('option', { name: 'PC', exact: true }).click();
  await form.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
  return code;
}

test.describe('Tìm kiếm tiếng Việt không dấu', () => {
  test('đường hạnh phúc: gõ KHÔNG DẤU ra đúng hàng CÓ DẤU, và gõ CÓ DẤU vẫn ra', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = await createDeviceWithDiacritics(page, stamp);
    const row = page.getByRole('row', { name: new RegExp(code) });

    // Đây là câu hỏi trung tâm của cả file: không gấp dấu thì dòng này trả về 0 hàng.
    await searchAndWaitForFilter(page, 'may tram');
    await expect(row).toBeVisible();

    // `đ` không phải ký tự tổ hợp nên `NFD` không tách được — nó phải được thay riêng, ở cả
    // ba bản gấp dấu. Ô này là chỗ duy nhất bắt được nếu một bản quên.
    await searchAndWaitForFilter(page, 'duong moi');
    await expect(row).toBeVisible();

    // Chữa bệnh này KHÔNG được làm mắc bệnh ngược lại: gõ đủ dấu vẫn phải ra.
    await searchAndWaitForFilter(page, 'Máy trạm');
    await expect(row).toBeVisible();

    // Và mã vẫn tìm được như cũ — cột sinh gộp bốn cột, không thay thế cột nào.
    await searchAndWaitForFilter(page, code);
    await expect(row).toBeVisible();
  });

  test('đường hỏng: từ khoá không khớp thì nói KHÔNG KHỚP, không nói kho trống', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = await createDeviceWithDiacritics(page, stamp);

    await searchAndWaitForFilter(page, 'may chu ao hoa');
    await expect(page.getByRole('row', { name: new RegExp(code) })).toHaveCount(0);
    /*
     * Hai câu trả lời KHÁC NHAU, không được gộp làm một: "kho trống" dẫn người đọc tới kết
     * luận chưa ai khai thiết bị nào, còn "không khớp bộ lọc" dẫn tới việc nới ô tìm. Ở đây
     * kho KHÔNG trống, nên câu đúng là câu thứ hai.
     */
    // Câu rỗng nêu lại đúng từ khoá vừa gõ (DEV-009).
    await expect(page.getByText('Không có thiết bị nào khớp “may chu ao hoa”.')).toBeVisible();
  });

  test('danh mục: gõ không dấu ra đúng site — đường ims_norm tính tại chỗ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const siteCode = `E2E-TS-${stamp}`;

    await page.goto('/admin/catalog');
    await page.getByRole('button', { name: 'Thêm site' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Mã').fill(siteCode);
    await form.getByLabel('Tên').fill('Trụ sở Hà Nội');
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(siteCode) })).toBeVisible();

    /*
     * Danh mục KHÔNG có cột sinh (bảy bảng tra cứu, mỗi bảng vài chục dòng — xem chú thích ở
     * `catalog.service.ts`). Nó đi đường `imsNormLike`, tính `ims_norm()` ngay trong câu
     * truy vấn. Hai đường khác nhau thì phải có hai bài, nếu không sửa một đường là tưởng đã
     * sửa cả hai.
     *
     * Màn danh mục chưa dùng `useListUrlState` nên ô tìm không có debounce — điền thẳng, rồi
     * chờ bằng chính hàng phải hiện ra.
     */
    await page.getByRole('searchbox', { name: /Tìm/ }).fill('tru so');
    await expect(page.getByRole('row', { name: new RegExp(siteCode) })).toBeVisible();
  });

  test('bảng lệnh Ctrl+K: gõ không dấu nhảy được sang màn — đường gấp dấu Ở TRÌNH DUYỆT', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/');

    /*
     * CHỜ MÀN DỰNG XONG RỒI MỚI GÕ PHÍM TẮT.
     *
     * `page.goto` trả về khi tài liệu tải xong, còn Ctrl+K thì do một listener React gắn lên
     * `document` sau khi hydrate. Gõ vào khoảng giữa là phím rơi vào hư không, và bài đỏ ở
     * dòng "mở hộp" với một thông báo chẳng liên quan gì tới gấp dấu.
     */
    await expect(page.getByRole('navigation', { name: /Điều hướng/ })).toBeVisible();

    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Tìm nhanh' });
    await expect(palette).toBeVisible();

    /*
     * Nhóm "Màn hình" của bảng lệnh lọc NGAY TRONG TRÌNH DUYỆT trên nhãn đã dịch — không có
     * lượt gọi API nào để mà gấp dấu ở tầng SQL. Đây là đường mã duy nhất trong bài này không
     * chạm Postgres, nên nó phải có ô riêng.
     */
    // Soi TRONG nhóm "Màn hình", không soi cả hộp: bốn nhóm kia là kết quả API và chúng cũng
    // có thể chứa chữ "Thiết bị". Khoanh vào đúng nhóm là cách duy nhất để ô này chỉ xanh
    // được vì phép gấp dấu ở trình duyệt, chứ không xanh nhờ một hồ sơ trùng chữ.
    const screen = palette.getByRole('group', { name: 'Màn hình' });

    await palette.getByRole('combobox').fill('thiet bi');
    await expect(screen.getByRole('option', { name: /^Thiết bị/ })).toBeVisible();

    // Và vẫn tìm được khi gõ đủ dấu — chữa bệnh này không được làm mắc bệnh ngược lại.
    await palette.getByRole('combobox').fill('Sổ NAT');
    await expect(screen.getByRole('option', { name: /^Sổ NAT/ })).toBeVisible();
  });
});
