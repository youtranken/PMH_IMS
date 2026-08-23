import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderWithI18n, screen } from '@/test/test-utils';
import { RevealDialog } from '@/ui/reveal-dialog';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Đẩy cả đồng hồ hệ thống lẫn timer — đếm ngược tính từ mốc, không trừ dần theo nhịp. */
function advance(seconds: number) {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

describe('RevealDialog — tự ẩn sau N giây (FR-022)', () => {
  it('hiện giá trị và đếm ngược từ số giây được truyền vào', () => {
    renderWithI18n(
      <RevealDialog label="admin web" value="Sup3r#Secret" seconds={30} onClose={() => {}} />,
    );
    expect(screen.getByTestId('secret-value')).toHaveTextContent('Sup3r#Secret');
    expect(screen.getByRole('status')).toHaveTextContent('Tự ẩn sau 30 giây');

    advance(5);
    expect(screen.getByRole('status')).toHaveTextContent('Tự ẩn sau 25 giây');
  });

  it('hết giờ thì gọi onClose đúng MỘT lần', () => {
    const onClose = vi.fn();
    renderWithI18n(
      <RevealDialog label="admin web" value="Sup3r#Secret" seconds={3} onClose={onClose} />,
    );
    advance(2);
    expect(onClose).not.toHaveBeenCalled();

    advance(1.5);
    expect(onClose).toHaveBeenCalled();
  });

  /**
   * Đây là lý do đếm ngược tính TỪ MỐC chứ không trừ dần: trình duyệt hãm `setInterval`
   * của tab nền xuống ~1 lần/phút. Kiểu trừ dần thì đi họp 10 phút về, mật khẩu vẫn còn
   * nằm trên màn hình chờ đủ 30 nhịp. Ở đây một nhịp muộn là đóng ngay.
   */
  it('tab bị hãm nhịp: một nhịp muộn duy nhất cũng đủ đóng, không cần đủ N nhịp', () => {
    const onClose = vi.fn();
    renderWithI18n(
      <RevealDialog label="admin web" value="Sup3r#Secret" seconds={30} onClose={onClose} />,
    );
    // Một nhịp duy nhất, đến muộn 10 phút.
    act(() => {
      vi.setSystemTime(new Date(Date.now() + 600_000));
      vi.advanceTimersByTime(250);
    });
    expect(onClose).toHaveBeenCalled();
  });
});
