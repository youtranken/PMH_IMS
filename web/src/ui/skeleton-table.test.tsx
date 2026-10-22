import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkeletonTable } from '@/ui/skeleton-rows';
import { renderWithI18n } from '@/test/test-utils';

/**
 * ST-03: 300ms đầu khung xương chưa vẽ gì → trang trống trơn rồi nhảy; điện thoại vẫn vẽ vạch kiểu
 * bảng trong khi danh sách thật là thẻ.
 */
afterEach(() => vi.unstubAllGlobals());

describe('SkeletonTable', () => {
  it('giữ chỗ ngay từ đầu: đủ dòng, vạch ẩn tới khi qua 300ms', () => {
    const { container } = renderWithI18n(<SkeletonTable />);
    expect(container.querySelectorAll('.skeleton-line')).toHaveLength(6);
    expect(container.querySelector('.skeleton-table')).not.toHaveAttribute('data-shown');
  });
  it('màn ≤600px: khung xương dạng thẻ', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }));
    const { container } = renderWithI18n(<SkeletonTable />);
    expect(container.querySelector('.skeleton-cards')).not.toBeNull();
    expect(container.querySelector('.skeleton-table')).toBeNull();
  });
});
