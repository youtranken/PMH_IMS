import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { FilterBar } from '@/ui/filter-bar';

/** Giả lập bề ngang màn hình cho `matchMedia` (jsdom không có). */
function viewport(width: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? width <= Number(max[1]) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    };
  }) as unknown as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function bar(activeCount: number, collapsible = true) {
  return (
    <FilterBar
      search=""
      onSearchChange={vi.fn()}
      searchPlaceholder="Tìm"
      activeCount={activeCount}
      onClear={vi.fn()}
      collapsible={collapsible}
    >
      <select aria-label="Hành động" />
      <select aria-label="Loại đối tượng" />
    </FilterBar>
  );
}

/*
 * Thanh lọc năm ô trên điện thoại cao hơn cả màn hình đầu tiên: người mở Nhật ký để xem "vừa
 * có gì" phải cuộn qua cả khối lọc. `collapsible` gập các ô lọc sau một nút "Bộ lọc (n)".
 */
describe('FilterBar `collapsible` — gập ô lọc trên điện thoại', () => {
  it('≤600px: chỉ còn ô tìm + nút "Bộ lọc (n)"; bấm là mở, bấm lại là gập', async () => {
    viewport(390);
    renderWithI18n(bar(2));
    expect(screen.getByRole('searchbox', { name: 'Tìm' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Hành động' })).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Bộ lọc (2)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('combobox', { name: 'Hành động' })).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByRole('combobox', { name: 'Hành động' })).not.toBeInTheDocument();
  });

  it('chưa lọc gì thì nút không kèm số', () => {
    viewport(390);
    renderWithI18n(bar(0));
    expect(screen.getByRole('button', { name: 'Bộ lọc' })).toBeInTheDocument();
  });

  it('màn rộng: bày đủ ô lọc, không có nút gập', () => {
    viewport(1280);
    renderWithI18n(bar(2));
    expect(screen.getByRole('combobox', { name: 'Hành động' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Bộ lọc/ })).not.toBeInTheDocument();
  });

  it('không bật `collapsible` thì điện thoại vẫn bày đủ như cũ', () => {
    viewport(390);
    renderWithI18n(bar(2, false));
    expect(screen.getByRole('combobox', { name: 'Hành động' })).toBeInTheDocument();
  });
});
