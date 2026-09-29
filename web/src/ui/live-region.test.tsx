import { describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useAnnounce, LiveRegion } from '@/ui/live-region';

/**
 * Vùng sống phải CÓ MẶT TRƯỚC khi nội dung đổi, và phải sống LÂU HƠN thứ nó nói về.
 *
 * Hai luật ấy là cả nội dung của vùng sống cho `Loading`. Bài này kiểm được chúng mà không cần trình
 * đọc màn hình: luật một = node tồn tại khi chưa ai loan báo gì; luật hai = gỡ MỘT người loan
 * báo trong khi người khác còn sống thì chữ không được biến mất.
 */

function Speaker({ text }: { text: string }) {
  useAnnounce(text);
  return null;
}

function region() {
  return screen.getByRole('status');
}

describe('LiveRegion', () => {
  it('node có mặt ngay cả khi chưa ai loan báo gì', () => {
    /*
     * Ô quan trọng nhất của cả bài: `role="status"` gắn trên chính
     * node "đang tải" thì node ấy chỉ ra đời CÙNG nội dung, và trình đọc màn hình bỏ qua.
     */
    render(<LiveRegion />);
    expect(region()).toBeTruthy();
    expect(region().textContent).toBe('');
  });

  it('loan báo hiện ra, và rút đi khi component tháo', () => {
    const { rerender } = render(
      <>
        <LiveRegion />
        <Speaker text="Đang tải…" />
      </>,
    );
    expect(region().textContent).toBe('Đang tải…');

    rerender(<LiveRegion />);
    expect(region().textContent).toBe('');
  });

  it('sáu khối cùng tải: gỡ một khối KHÔNG làm câu loan báo biến mất', () => {
    /*
     * Cảnh thật của bảng điều khiển. Với một biến "chữ hiện tại" thay vì một tập, khối tải
     * xong đầu tiên sẽ xoá lời loan báo trong khi năm khối kia còn đang tải — người dùng nghe
     * "đang tải" rồi im bặt và kết luận là xong.
     */
    const { rerender } = render(
      <>
        <LiveRegion />
        <Speaker text="Đang tải…" />
        <Speaker text="Đang tải…" />
      </>,
    );
    expect(region().textContent).toBe('Đang tải…');

    rerender(
      <>
        <LiveRegion />
        <Speaker text="Đang tải…" />
      </>,
    );
    expect(region().textContent).toBe('Đang tải…');

    rerender(<LiveRegion />);
    expect(region().textContent).toBe('');
  });

  it('đổi chữ trong khi vẫn đang sống thì vùng đọc chữ mới', () => {
    const { rerender } = render(
      <>
        <LiveRegion />
        <Speaker text="Đang tải…" />
      </>,
    );
    act(() => {
      rerender(
        <>
          <LiveRegion />
          <Speaker text="Đang tải danh sách thiết bị…" />
        </>,
      );
    });
    expect(region().textContent).toBe('Đang tải danh sách thiết bị…');
  });

  it('hai lượt render liên tiếp KHÔNG đăng ký hai lời', () => {
    /*
     * Vế đối chứng cho `useRef` trong `useAnnounce`. Đăng ký lại ở mỗi lượt render thì tập
     * phình ra và lời cũ không bao giờ được gỡ — vùng sống sẽ đọc "đang tải" mãi mãi, một lỗi
     * chỉ lộ ra sau vài phút dùng chứ không lộ ở lượt đầu.
     */
    const { rerender } = render(
      <>
        <LiveRegion />
        <Speaker text="Đang tải…" />
      </>,
    );
    rerender(
      <>
        <LiveRegion />
        <Speaker text="Đang tải…" />
      </>,
    );
    rerender(<LiveRegion />);
    expect(region().textContent).toBe('');
  });
});
