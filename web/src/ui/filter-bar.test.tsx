import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen } from '@/test/test-utils';
import { FilterBar } from '@/ui/filter-bar';

describe('FilterBar — khung thẻ chỉ khi có nhiều hơn một ô', () => {
  /*
   * Một ô tìm duy nhất bọc trong thẻ viền là hai lớp viền và ~60px chiều cao mất không trên
   * điện thoại, trước khi thấy dòng dữ liệu đầu tiên.
   */
  it('chỉ có ô tìm thì thanh lọc không mang khung thẻ', () => {
    const { container } = renderWithI18n(
      <FilterBar search="" onSearchChange={vi.fn()} searchPlaceholder="Tìm" />,
    );
    expect(container.querySelector('.filter-bar')).toHaveClass('is-bare');
    expect(screen.getByRole('searchbox', { name: 'Tìm' })).toBeInTheDocument();
  });

  it('có bộ lọc đi kèm thì giữ khung thẻ', () => {
    const { container } = renderWithI18n(
      <FilterBar search="" onSearchChange={vi.fn()} searchPlaceholder="Tìm">
        <select aria-label="Trạng thái" />
      </FilterBar>,
    );
    expect(container.querySelector('.filter-bar')).not.toHaveClass('is-bare');
  });

  it('con là `null` (bộ lọc ẩn theo tab) vẫn tính là chỉ có ô tìm', () => {
    const { container } = renderWithI18n(
      <FilterBar search="" onSearchChange={vi.fn()} searchPlaceholder="Tìm">
        {null}
      </FilterBar>,
    );
    expect(container.querySelector('.filter-bar')).toHaveClass('is-bare');
  });
});
