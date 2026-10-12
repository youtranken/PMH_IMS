import { describe, expect, it, vi } from 'vitest';
import { FilterToggle } from '@/ui/filter-toggle';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

describe('FilterToggle — chip bật/tắt một bộ lọc', () => {
  it('là nút có aria-pressed; bấm thì báo giá trị ngược lại', async () => {
    const onChange = vi.fn();
    renderWithI18n(
      <FilterToggle pressed={false} onChange={onChange}>
        Chỉ cổng nhạy cảm
      </FilterToggle>,
    );
    const button = screen.getByRole('button', { name: 'Chỉ cổng nhạy cảm' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.setup().click(button);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('đang bật thì aria-pressed=true và bấm là tắt', async () => {
    const onChange = vi.fn();
    renderWithI18n(
      <FilterToggle pressed onChange={onChange}>
        Ẩn mục đã quá hạn
      </FilterToggle>,
    );
    const button = screen.getByRole('button', { name: 'Ẩn mục đã quá hạn' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(button);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
