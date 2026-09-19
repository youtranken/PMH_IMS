import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { CommandPalette } from '@/ui/command-palette';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import type { Me } from '@/lib/me';

/**
 * ⌘K KHAI MÌNH CHẶN THÌ PHẢI CHẶN THẬT.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * Hộp tìm nhanh khai `role="dialog" aria-modal="true"` nhưng chưa bao giờ giữ tiêu điểm lại.
 * Đo ngày 19/09/2026: mở ⌘K rồi gõ Tab một lần là `activeElement` về `<body>`, gõ tiếp thì đi
 * vào nút bên ngoài. Mà `aria-modal="true"` chính là lời dặn trình đọc màn hình CẤT phần ngoài
 * hộp khỏi bộ đệm ảo — nên người dùng bàn phím đang Tab vào những phần tử mà họ không nghe
 * thấy gì, và không có dấu hiệu nào cho biết mình đã rời hộp.
 *
 * ===== BÀI NÀY HỎI GÌ =====
 *
 * Hai câu. Tab không được rời hộp — kiểm bằng một nút mồi đặt NGOÀI hộp, thứ mà bản hỏng sẽ
 * nhảy tới. Và các dòng kết quả không được là chỗ dừng Tab: ở mẫu combobox chúng do ↑/↓ +
 * `aria-activedescendant` điều khiển, để chúng nhận Tab là biến hộp tìm nhanh thành hai mươi
 * nhịp Tab.
 */

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;
const trang = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 3 });

function dung() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/devices')) {
        return Promise.resolve(
          jsonResponse(200, trang([{ id: 'd1', code: 'TB-E2E-01', name: 'Switch', siteCode: 'HN' }])),
        );
      }
      return Promise.resolve(jsonResponse(200, trang([])));
    }),
  );
  renderWithI18n(
    <MemoryRouter>
      <ConfirmProvider>
        {/* Mồi: nằm NGOÀI hộp, là nơi tiêu điểm rơi vào khi phép giữ bị gỡ. */}
        <button type="button">nút ngoài hộp</button>
        <CommandPalette me={me} />
      </ConfirmProvider>
    </MemoryRouter>,
  );
}

describe('⌘K giữ tiêu điểm trong hộp', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Tab KHÔNG rời khỏi hộp, dù trang có nút bấm được ở ngoài', async () => {
    const user = userEvent.setup();
    dung();
    await user.keyboard('{Control>}k{/Control}');

    const oTim = screen.getByRole('combobox', { name: /tìm nhanh/i });
    /* CHỜ, đừng khẳng định ngay: hộp lấy tiêu điểm trong `requestAnimationFrame`, nên dưới tải
       của lượt chạy đầy đủ nó chưa chắc xong ở nhịp này. Bản đầu của bài kiểm này khẳng định
       thẳng và đỏ ngẫu nhiên đúng một lượt — tự nó thành thứ nó sinh ra để chặn. */
    await waitFor(() => expect(document.activeElement).toBe(oTim));

    await user.tab();
    expect(document.activeElement).toBe(oTim);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(oTim);

    // Nói thẳng điều đang canh: tiêu điểm KHÔNG được ở nút ngoài hộp.
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'nút ngoài hộp' }));
  });

  it('dòng kết quả không phải chỗ dừng Tab — chúng do ↑/↓ điều khiển', async () => {
    const user = userEvent.setup();
    dung();
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('combobox', { name: /tìm nhanh/i }), 'qxz');

    const dong = await screen.findByRole('option', { name: /TB-E2E-01/ });
    expect(dong.getAttribute('tabindex')).toBe('-1');
  });
});
