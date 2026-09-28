import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderWithI18n, screen, within } from '@/test/test-utils';
import { formatMinSec, RevealDialog, secretCharClass } from '@/ui/reveal-dialog';

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
      <RevealDialog label="admin web" value="Sup3r#Secret" seconds={60} onClose={() => {}} />,
    );
    expect(screen.getByTestId('secret-value')).toHaveTextContent('Sup3r#Secret');
    expect(screen.getByTestId('reveal-countdown')).toHaveTextContent('60s');

    advance(5);
    expect(screen.getByTestId('reveal-countdown')).toHaveTextContent('55s');
  });

  /**
   * HAI đồng hồ đếm từ CÙNG một mốc.
   *
   * "60s / 600s" lúc mở, và mở tiếp secret thứ hai sau 10 giây phải ra "60s / 590s" — số phải
   * đi tiếp chứ không quay về đầu. Trừ dần theo nhịp thì tab bị hãm sẽ làm hai số trôi lệch
   * nhau, và số bên phải nói dối đúng ở chỗ người dùng dựa vào nó để tính giờ.
   */
  it('đếm ngược grace step-up chạy song song, cùng mốc với đồng hồ tự ẩn', () => {
    renderWithI18n(
      <RevealDialog
        label="admin web"
        value="Sup3r#Secret"
        seconds={60}
        stepUpSecondsLeft={600}
        onClose={() => {}}
      />,
    );
    // Phút:giây — "600s" không ai đọc ra là mười phút.
    expect(screen.getByTestId('stepup-countdown')).toHaveTextContent('10:00');

    advance(10);
    expect(screen.getByTestId('reveal-countdown')).toHaveTextContent('50s');
    expect(screen.getByTestId('stepup-countdown')).toHaveTextContent('9:50');
  });

  /** Không truyền grace (nơi gọi cũ) thì chỉ một đồng hồ, không vẽ ra số 0 vô nghĩa. */
  it('không có grace thì không hiện đồng hồ thứ hai', () => {
    renderWithI18n(
      <RevealDialog label="admin web" value="Sup3r#Secret" seconds={60} onClose={() => {}} />,
    );
    expect(screen.queryByTestId('stepup-countdown')).toBeNull();
  });

  /**
   * Màu là thứ người dùng liếc thấy trước cả con số. Còn nhiều → xanh (`calm`), sắp hết →
   * đỏ nhấp nháy (`urgent`). Luật màu nằm ở `countdownTone` (có bảng test riêng); ở đây chỉ
   * khóa việc dialog THẬT SỰ gắn class đó vào con số.
   */
  it('con số đổi class theo phần còn lại: xanh → đỏ', () => {
    renderWithI18n(
      <RevealDialog label="admin web" value="Sup3r#Secret" seconds={60} onClose={() => {}} />,
    );
    expect(screen.getByTestId('reveal-countdown').querySelector('.countdown-num')).toHaveClass(
      'calm',
    );

    advance(49);
    expect(screen.getByTestId('reveal-countdown').querySelector('.countdown-num')).toHaveClass(
      'urgent',
    );
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

describe('RevealDialog — đọc để gõ tay', () => {
  it('hiện kèm tên đăng nhập: người ta cần CẶP user + mật khẩu', () => {
    renderWithI18n(
      <RevealDialog label="enable" username="admin" value="Ab1#" seconds={60} onClose={() => {}} />,
    );
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('giá trị giữ nguyên chữ, mỗi ký tự mang lớp để tô màu', () => {
    renderWithI18n(<RevealDialog label="x" value="aB3#" seconds={60} onClose={() => {}} />);
    const value = screen.getByTestId('secret-value');
    expect(value).toHaveTextContent(/^aB3#$/);
    expect(value.querySelector('.ch-digit')).toHaveTextContent('3');
    expect(value.querySelector('.ch-upper')).toHaveTextContent('B');
    expect(value.querySelector('.ch-symbol')).toHaveTextContent('#');
  });

  it('"Hiện từng ký tự": mỗi ký tự một ô có số thứ tự', () => {
    renderWithI18n(<RevealDialog label="x" value="l1O0" seconds={60} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hiện từng ký tự' }));
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['1l', '21', '3O', '40']);
  });

  it.each([
    ['7', 'digit'],
    ['Q', 'upper'],
    ['q', 'lower'],
    ['!', 'symbol'],
  ])('secretCharClass(%p) = %p', (ch, expected) => {
    expect(secretCharClass(ch)).toBe(expected);
  });

  it.each([
    [600, '10:00'],
    [552, '9:12'],
    [5, '0:05'],
    [-3, '0:00'],
  ])('formatMinSec(%p) = %p', (seconds, expected) => {
    expect(formatMinSec(seconds)).toBe(expected);
  });
});
