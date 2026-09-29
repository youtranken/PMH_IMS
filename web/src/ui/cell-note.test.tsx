import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { CellNote } from '@/ui/cell-note';

const LONG = 'Mở cho đối tác giám sát camera từ xa, hết hợp đồng thì gỡ';

/** jsdom không dàn trang: giả lập ô bị cắt bằng cách cho `scrollWidth` lớn hơn `clientWidth`. */
function fakeTruncated(truncated: boolean) {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(truncated ? 400 : 100);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
}

/*
 * Ghi chú bị cắt bằng dấu "…" mà đủ câu chỉ nằm ở `title`: người dùng bàn phím và màn cảm ứng
 * (không có hover) không bao giờ đọc được phần còn lại. Ô bị cắt phải là một nút mở ra được.
 */
describe('CellNote', () => {
  afterEach(() => vi.restoreAllMocks());

  it('không bị cắt: chữ thường, không thêm điểm dừng Tab', () => {
    fakeTruncated(false);
    renderWithI18n(<CellNote text="Ngắn" />);
    expect(screen.getByText('Ngắn')).toHaveClass('cell-note');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('bị cắt: là nút có đủ câu làm tên, bấm thì mở ra, bấm lại thì thu vào', async () => {
    fakeTruncated(true);
    renderWithI18n(<CellNote text={LONG} />);
    const button = screen.getByRole('button', { name: LONG });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveClass('is-open');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('mở rồi thu lại: vẫn là cùng một nút và giữ tiêu điểm', async () => {
    fakeTruncated(true);
    renderWithI18n(<CellNote text={LONG} />);
    const button = screen.getByRole('button', { name: LONG });
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: LONG }));
    expect(screen.getByRole('button', { name: LONG })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: LONG })).toHaveFocus();
  });

  it('bấm mở ghi chú không kích hoạt dòng bảng bấm được bao ngoài', () => {
    fakeTruncated(true);
    const onRow = vi.fn();
    renderWithI18n(
      <div onClick={onRow}>
        <CellNote text={LONG} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: LONG }));
    expect(onRow).not.toHaveBeenCalled();
  });

  it('nhận thêm class của nơi gọi (vd `cell-sub` cho dòng phụ)', () => {
    fakeTruncated(false);
    renderWithI18n(<CellNote text="Ghi chú" className="cell-sub" />);
    expect(screen.getByText('Ghi chú')).toHaveClass('cell-note', 'cell-sub');
  });
});
