import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { useFocusTrap } from '@/ui/focus-trap';

/**
 * BẪY TIÊU ĐIỂM CHO DRAWER 390px (F-06, vế 4).
 *
 * ===== VÌ SAO KIỂM ĐƯỢC BẰNG jsdom =====
 *
 * Ba lời hứa của hook đều là chuyện DOM thuần: tiêu điểm đang ở đâu, phím Tab đi tới đâu, và
 * ai nhận lại tiêu điểm khi lớp phủ đóng. jsdom trả lời được cả ba.
 *
 * Thứ jsdom KHÔNG trả lời được là bố cục: ở 390px drawer có thật sự che kín màn hình không,
 * backdrop có chặn được chuột không. Đó là việc của bài Playwright ở 390px — hai tầng hỏi hai
 * câu khác nhau, không thay nhau được.
 *
 * ===== BỐ TRÍ DOM CỦA BÀI NÀY GIỐNG HỆT CHỖ THẬT =====
 *
 * Nút mở đặt SAU lớp phủ trong DOM, đúng như `app-shell.tsx`: `<nav>` đứng trước, nút bật/tắt
 * nằm trong topbar phía sau. Đó chính là lý do lượt Tab kế tiếp đi vào nội dung chứ không đi
 * vào drawer — đặt nút trước lớp phủ là bài kiểm dựng một cảnh dễ hơn cảnh thật.
 */

function Khung({ items = 2 }: { items?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useFocusTrap<HTMLDivElement>(open);

  return (
    <div>
      {open ? (
        <div ref={ref} tabIndex={-1} data-testid="drawer">
          {Array.from({ length: items }, (_, i) => (
            <button key={i} type="button">
              Mục {i + 1}
            </button>
          ))}
        </div>
      ) : null}
      {/* SAU lớp phủ trong DOM — đúng thứ tự của `app-shell.tsx`. */}
      <button type="button" onClick={() => setOpen((v) => !v)}>
        Mở menu
      </button>
      <a href="#noi-dung">Nội dung trang</a>
    </div>
  );
}

function nutMo() {
  return screen.getByRole('button', { name: 'Mở menu' });
}

describe('useFocusTrap', () => {
  it('mở ra là tiêu điểm nhảy VÀO trong, không nằm lại ở nút mở', () => {
    /*
     * Ô nặng nhất của cả bài. Không có bước này thì nút mở nằm sau `<nav>` trong DOM, nên lượt
     * Tab kế tiếp đi vào nội dung trang — người đi bàn phím mở được menu ra rồi không vào nổi.
     */
    render(<Khung />);
    nutMo().focus();
    fireEvent.click(nutMo());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mục 1' }));
  });

  it('Tab ở mục cuối vòng về mục đầu', () => {
    render(<Khung />);
    fireEvent.click(nutMo());
    const cuoi = screen.getByRole('button', { name: 'Mục 2' });
    cuoi.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mục 1' }));
  });

  it('Shift+Tab ở mục đầu vòng về mục cuối', () => {
    render(<Khung />);
    fireEvent.click(nutMo());
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mục 2' }));
  });

  it('tiêu điểm lọt ra ngoài thì bị kéo về', () => {
    // Bấm chuột vào một link phía sau drawer: backdrop chặn được chuột thật, nhưng bàn phím
    // và trình đọc màn hình vẫn có đường tới. Bẫy phải kéo về ở lượt Tab kế tiếp.
    render(<Khung />);
    fireEvent.click(nutMo());
    screen.getByRole('link', { name: 'Nội dung trang' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mục 1' }));
  });

  it('đóng lại thì tiêu điểm TRỞ VỀ nút đã mở, không rơi về body', () => {
    render(<Khung />);
    nutMo().focus();
    fireEvent.click(nutMo());
    fireEvent.click(nutMo()); // đóng
    expect(document.activeElement).toBe(nutMo());
  });

  it('lớp phủ không có gì bấm được thì tiêu điểm đặt lên chính nó', () => {
    // Vai `member` thấy ít mục hơn; một bản dựng nào đó có thể ra drawer rỗng. Không có vế
    // này thì `first` là `undefined` và cả bẫy im lặng không làm gì.
    render(<Khung items={0} />);
    fireEvent.click(nutMo());
    expect(document.activeElement).toBe(screen.getByTestId('drawer'));
  });

  it('KHÔNG bật thì không đụng gì tới tiêu điểm (vế đối chứng)', () => {
    /*
     * Desktop dùng đúng component này với `active = false`. Thiếu ô này thì một bản hook bẫy
     * vô điều kiện cũng làm mọi ô trên xanh, rồi khoá tiêu điểm vào sidebar ở màn rộng.
     */
    render(<Khung />);
    const link = screen.getByRole('link', { name: 'Nội dung trang' });
    link.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(link);
  });
});
