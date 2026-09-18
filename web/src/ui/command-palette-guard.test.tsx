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
    expect(oTim()).toBeNull();
  });
});
