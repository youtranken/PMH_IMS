import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WarrantyTimeline } from '@/ui/warranty-timeline';
import { renderWithI18n, screen } from '@/test/test-utils';

/**
 * Ở 390px ô bảo hành chỉ còn nửa thẻ: nhãn dài "Bảo hành từ" gãy ba dòng đè lên ngày. Màn hẹp
 * rút nhãn hai mốc còn "Từ"/"Đến" — tên đầy đủ vẫn nằm ở nhãn của dòng ("Bảo hành").
 */
function renderAt(narrow: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: narrow,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  return renderWithI18n(
    <QueryClientProvider client={new QueryClient()}>
      <WarrantyTimeline
        start="2026-01-01"
        end="2027-01-01"
        now={new Date('2026-06-01')}
        startLabel="Bảo hành từ"
        endLabel="Bảo hành đến"
      />
    </QueryClientProvider>,
  );
}

describe('WarrantyTimeline — nhãn mốc theo bề ngang', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('màn rộng: giữ nhãn đầy đủ', () => {
    renderAt(false);
    expect(screen.getByText('Bảo hành từ', { exact: false })).toBeInTheDocument();
  });

  it('màn hẹp: nhãn mốc rút còn Từ/Đến', () => {
    renderAt(true);
    expect(screen.queryByText('Bảo hành từ', { exact: false })).toBeNull();
    expect(screen.getByText(/^Từ/)).toBeInTheDocument();
    expect(screen.getByText(/^Đến/)).toBeInTheDocument();
  });
});
