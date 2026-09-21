import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { CommandPalette } from '@/ui/command-palette';
import { Dialog } from '@/ui/dialog';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import type { Me } from '@/lib/me';

/**
 * ⌘K KHÔNG ĐƯỢC MỞ CHỒNG LÊN HỘP THOẠI.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * Hộp Radix đặt `pointer-events: none` lên `body` và chỉ mở lại cho vùng bên trong `Content`.
 * `CommandPalette` gắn ở shell, tức NGOÀI vùng ấy. Mở nó chồng lên một hộp thoại thì ra một
 * lớp phủ CHẾT, và cả bốn triệu chứng đều đo được trên trình duyệt thật ngày 18/09/2026:
 *
 *   · `--z-palette` (85) cao hơn `--z-modal` (60) → nó che kín màn hình;
 *   · `pointer-events` kế thừa `none` → không bấm được vào đâu;
 *   · tiêu điểm vẫn nằm trong hộp thoại (`sheet-close`) → gõ "abc" xong ô tìm vẫn rỗng;
 *   · Esc rơi xuống hộp bên dưới → đóng nhầm cái hộp người ta đang làm dở.
 *
 * Và kể cả nếu bấm được: `go()` gọi thẳng `navigate()`, đi vòng qua `guardUnsaved` của hộp
 * đang mở — mất trắng dữ liệu đang gõ mà không một câu hỏi lại.
 *
 * ===== BÀI NÀY HỎI GÌ =====
 *
 * Hai câu, đúng theo thứ tự người dùng gặp: bình thường ⌘K phải mở được (nếu không thì bản vá
 * này đã giết luôn tính năng), và khi có hộp thoại thì nó phải im.
 */

const me = {
  role: 'sa',
  csrfToken: 'x',
  email: 'sa@pmh.com.vn',
} as unknown as Me;

describe('⌘K và hộp thoại không giẫm lên nhau', () => {
  const oTim = () => screen.queryByRole('dialog', { name: /tìm nhanh/i });

  /*
   * HỎI DOM, KHÔNG HỎI CÂY TRỢ NĂNG — CHỈ Ở BÀI THỨ HAI (19/09/2026).
   *
   * Khi một hộp Radix đang mở, nó đặt `aria-hidden="true"` lên MỌI nhánh anh em ngoài
   * `Content`. `CommandPalette` gắn ở shell, tức nằm trong một nhánh như thế — nên
   * `queryByRole` trả `null` DÙ palette đã render và đang phủ kín màn hình. Bài thứ hai vì vậy
   * từng xanh vì lý do sai: đợt rà 19/09 vô hiệu hoá đúng dòng bản vá
   * (`if (!open && isAnyDialogOpen()) return;`) và bài vẫn 2/2 XANH, trong khi dump DOM cho
   * thấy `.cp-wrap` + `role="dialog"` có mặt đầy đủ — đúng lớp phủ chết mà cả khối chú thích
   * trên đây mô tả (`--z-palette` 85 > `--z-modal` 60).
   *
   * Người dùng thật không nhìn bằng cây trợ năng; thứ che mất màn hình là DOM. Bài 1 thì GIỮ
   * `queryByRole`: ở đó không có hộp nào, cây trợ năng còn sạch, và "palette có được phơi ra
   * cho trình đọc màn hình không" là một câu hỏi đáng giữ.
   */
  const oTimTrongDom = () =>
    // `Array.from`, không phải spread: `tsconfig.app.json` không bật `downlevelIteration`, nên
    // `[...NodeListOf]` là lỗi biên dịch TS2488 — và cổng kiểu của web là `npm run build`.
    Array.from(document.querySelectorAll('[role="dialog"]')).find((el) =>
      /tìm nhanh/i.test(el.getAttribute('aria-label') ?? ''),
    ) ?? null;

  it('không có hộp thoại: ⌘K mở được', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <MemoryRouter>
        <ConfirmProvider>
          <CommandPalette me={me} />
        </ConfirmProvider>
      </MemoryRouter>,
    );

    expect(oTim()).toBeNull();
    await user.keyboard('{Control>}k{/Control}');
    expect(oTim()).not.toBeNull();
  });

  it('đang có hộp thoại mở: ⌘K KHÔNG mở palette', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <MemoryRouter>
        <ConfirmProvider>
          <CommandPalette me={me} />
          <Dialog open onOpenChange={() => undefined} title="Sửa hồ sơ">
            <p>thân hộp</p>
          </Dialog>
        </ConfirmProvider>
      </MemoryRouter>,
    );

    await screen.findByText('thân hộp');
    await user.keyboard('{Control>}k{/Control}');
    expect(oTimTrongDom()).toBeNull();
  });
});
