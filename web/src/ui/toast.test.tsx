import { describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from '@/ui/toast';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * TOAST LỖI PHẢI MANG VAI `alert`; toast thường thì KHÔNG.
 *
 * ===== VÌ SAO ĐÁNG MỘT BÀI KIỂM =====
 *
 * Vùng chứa toast là `aria-live="polite"` — "chờ người dùng ngừng thao tác rồi hãy đọc". Đúng
 * cho "Đã lưu hồ sơ"; SAI cho một câu lỗi: người dùng vừa bấm Lưu và đang gõ tiếp, trình đọc
 * màn hình lặng lẽ xếp hàng, và họ đi tiếp trong khi lượt ghi đã hỏng. Một phần tử mang vai
 * `alert` vừa chèn vào trang thì được đọc NGAY.
 *
 * Đây là thứ KHÔNG nhìn thấy bằng mắt, nên chỉ một bài kiểm đọc thuộc tính mới giữ được luật.
 *
 * VÀ VẾ THỨ HAI QUAN TRỌNG KHÔNG KÉM. Bản vá đầu đặt `role="alert"` lên một VÙNG CHỨA riêng,
 * luôn nằm trong DOM kể cả khi rỗng — thế là mọi trang của sản phẩm có thêm một `alert` thứ
 * hai, và sáu bài E2E đang hỏi "câu lỗi trên màn đăng nhập nói gì" đỏ vì `getByRole('alert')`
 * trúng hai phần tử. Bài dưới cùng chốt đúng điều đó: KHÔNG có lỗi thì không có `alert` nào.
 */
function ToastFireButton({ tone, text, label }: { tone: 'ok' | 'error'; text: string; label: string }) {
  const toast = useToast();
  // Nhãn nút KHÁC nội dung toast: giống nhau thì `getByText` trúng cả hai và đỏ vì strict mode.
  return (
    <button type="button" onClick={() => toast({ message: text, tone })}>
      {label}
    </button>
  );
}

function containingRegion(el: HTMLElement | null): HTMLElement | null {
  return el?.closest('.toast-stack') as HTMLElement | null;
}

describe('Toast — lỗi phải được đọc NGAY', () => {
  it('toast lỗi nằm trong vùng assertive', async () => {
    renderWithI18n(
      <ToastProvider>
        <ToastFireButton tone="error" text="Lưu hỏng rồi" label="bắn lỗi" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'bắn lỗi' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Lưu hỏng rồi');
  });

  /*
   * VẾ ĐỐI CHỨNG. Thiếu nó thì một bản vá "cho tất cả vào assertive" cũng xanh — và đó là bản
   * tệ hơn: mỗi lần lưu xong lại cắt ngang thứ người dùng đang nghe, nên họ sẽ tắt hẳn thông
   * báo đi. `assertive` chỉ đáng dùng khi câu nói được có thứ cần dừng lại để nghe.
   */
  it('toast bình thường vẫn ở vùng polite — đừng cắt ngang vì một câu "Đã lưu"', async () => {
    renderWithI18n(
      <ToastProvider>
        <ToastFireButton tone="ok" text="Đã lưu hồ sơ" label="bắn ok" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'bắn ok' }));

    expect(containingRegion(screen.getByText('Đã lưu hồ sơ'))?.getAttribute('aria-live')).toBe('polite');
    expect(
      screen.queryByRole('alert'),
      'toast thường mà mang vai alert thì mỗi lần lưu xong lại cắt ngang thứ đang nghe',
    ).not.toBeInTheDocument();
  });

  it('hai loại cùng lúc thì mỗi cái về đúng vùng của nó', async () => {
    renderWithI18n(
      <ToastProvider>
        <ToastFireButton tone="ok" text="Đã lưu hồ sơ" label="bắn ok" />
        <ToastFireButton tone="error" text="Lưu hỏng rồi" label="bắn lỗi" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'bắn ok' }));
    await userEvent.click(screen.getByRole('button', { name: 'bắn lỗi' }));

    // ĐÚNG MỘT `alert` — của dòng lỗi. Dòng "Đã lưu" ở cùng vùng nhưng không mang vai đó.
    expect(screen.getByRole('alert')).toHaveTextContent('Lưu hỏng rồi');
    expect(screen.getByText('Đã lưu hồ sơ')).toBeInTheDocument();
  });

  it('không có lỗi thì KHÔNG có alert nào tồn tại trên trang', () => {
    renderWithI18n(
      <ToastProvider>
        <ToastFireButton tone="ok" text="Đã lưu hồ sơ" label="bắn ok" />
      </ToastProvider>,
    );
    expect(
      screen.queryByRole('alert'),
      'một vùng alert rỗng nằm vĩnh viễn là thứ trình đọc màn hình phải bước qua ở MỌI trang',
    ).not.toBeInTheDocument();
  });
});

function ActionToastButton({ onOpen }: { onOpen: () => void }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => toast({ message: 'Đã thêm LT-09.', action: { label: 'Mở hồ sơ', onClick: onOpen } })}
    >
      thêm
    </button>
  );
}

describe('Toast — nút bước kế tiếp', () => {
  it('bấm nút trong toast chạy việc đó và đóng toast', async () => {
    let opened = 0;
    renderWithI18n(
      <ToastProvider>
        <ActionToastButton onOpen={() => (opened += 1)} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'thêm' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mở hồ sơ' }));
    expect(opened).toBe(1);
    expect(screen.queryByText('Đã thêm LT-09.')).not.toBeInTheDocument();
  });
});

describe('Toast — nút đóng', () => {
  it('× là hình SVG dùng chung, không phải ký tự: ký tự đi theo đường cơ sở và rớt khỏi dòng chữ', async () => {
    renderWithI18n(
      <ToastProvider>
        <ToastFireButton tone="ok" text="Đã lưu." label="bắn ok" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'bắn ok' }));
    const close = screen.getByRole('button', { name: 'Đóng thông báo' });
    expect(close.querySelector('svg.glyph')).not.toBeNull();
    expect(close.textContent).toBe('');
  });
});
