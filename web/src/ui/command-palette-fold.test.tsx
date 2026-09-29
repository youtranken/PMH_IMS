import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { CommandPalette } from '@/ui/command-palette';
import { renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import type { Me } from '@/lib/me';

/**
 * TÌM KHÔNG DẤU Ở TẦNG TRÌNH DUYỆT — NHÓM "MÀN HÌNH" CỦA BẢNG LỆNH PHẢI GẤP DẤU.
 *
 * ===== VÌ SAO Ô NÀY NẰM Ở TẦNG VITEST, KHÔNG CHỈ Ở E2E =====
 *
 * Bốn nhóm kết quả của bảng lệnh đi hỏi API — chúng được `ims_norm()` bên Postgres lo. Nhóm
 * thứ năm, "Màn hình", lọc HOÀN TOÀN trong trình duyệt trên nhãn đã dịch (`t(item.key)`), nên
 * nó là đường tìm-không-dấu DUY NHẤT không chạm CSDL.
 *
 * Bài E2E cũng phủ đường này, nhưng nó phải dựng cả stack rồi build lại ảnh web mới hỏi được
 * một câu — mà chính vì thế, lúc đem đột biến ra thử nó đỏ ở dòng MỞ HỘP chứ không
 * đỏ ở dòng gấp dấu: một bài đỏ vì lý do khác thì không chứng minh được gì cả. Ở tầng này,
 * đổi `foldSearch(q)` thành `q.toLowerCase()` là đỏ đúng dòng, trong hai giây.
 *
 * Đo hai chiều, vì bản vá sai có hai kiểu: gấp một vế thôi (gõ không dấu thì ra, gõ có dấu
 * thì mất) hoặc không gấp vế nào.
 */

const me = {
  role: 'sa',
  csrfToken: 'x',
  email: 'sa@pmh.com.vn',
} as unknown as Me;

/**
 * Mở bảng lệnh rồi gõ một từ khoá.
 *
 * Ô nhập có nhịp lắng 200ms (`setTimeout` ở `command-palette.tsx`), nên hỏi DOM ngay sau khi
 * gõ xong là hỏi lúc `q` vẫn còn rỗng — và câu trả lời "không có nhóm nào" sẽ đúng vì lý do
 * hoàn toàn khác với thứ bài đang kiểm.
 */
async function moBangLenh(tuKhoa: string): Promise<void> {
  const user = userEvent.setup();
  renderWithI18n(
    <MemoryRouter>
      <ConfirmProvider>
        <CommandPalette me={me} />
      </ConfirmProvider>
    </MemoryRouter>,
  );
  await user.keyboard('{Control>}k{/Control}');
  await user.type(screen.getByRole('combobox', { name: /tìm nhanh/i }), tuKhoa);
}

describe('Bảng lệnh — tìm tên màn hình không dấu', () => {
  it('gõ KHÔNG DẤU ra đúng màn có dấu', async () => {
    await moBangLenh('thiet bi');
    // `find*` chứ không `query*`: nó chờ qua nhịp lắng 200ms. Khoanh trong nhóm "Màn hình"
    // để ô này chỉ xanh được nhờ phép gấp dấu ở trình duyệt, không nhờ một nhóm khác.
    const nhom = await screen.findByRole('group', { name: 'Màn hình' });
    // Tên trợ năng của một dòng là `title` + `sub`, tức "Thiết bị/devices" — neo ĐẦU CHUỖI
    // bằng regex. (Playwright khớp chuỗi-con nên bài E2E anh em viết chuỗi trần vẫn đúng;
    // Testing Library khớp TOÀN PHẦN. Hai khung, hai luật, cùng một ý định.)
    expect(within(nhom).getByRole('option', { name: /^Thiết bị/ })).toBeTruthy();
  });

  it('gõ CÓ DẤU vẫn ra — gấp dấu phải làm ở CẢ HAI VẾ', async () => {
    await moBangLenh('Sổ NAT');
    const nhom = await screen.findByRole('group', { name: 'Màn hình' });
    expect(within(nhom).getByRole('option', { name: /^Sổ NAT/ })).toBeTruthy();
  });

  it('từ khoá không khớp màn nào thì KHÔNG bịa ra nhóm "Màn hình"', async () => {
    /*
     * Cổng ngược: hai ô trên sẽ xanh y hệt nếu ai đó cho nhóm này khớp mọi thứ.
     *
     * Ở đây KHÔNG chờ được bằng `find*` — thứ cần chứng minh là một sự VẮNG MẶT. Chờ tới khi
     * ô nhập đã mang đủ chữ rồi mới hỏi: lúc ấy nhịp lắng đã chạy xong ít nhất một lượt cho
     * các ký tự trước đó, và `waitFor` bên dưới phủ nốt phần còn lại.
     */
    await moBangLenh('zzzz khong co man nao');
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Màn hình' })).toBeNull();
    });
  });
});
