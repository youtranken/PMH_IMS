import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { renderWithI18n, screen } from '@/test/test-utils';
import { useOpenFromUrl } from './use-open-from-url';

function Probe({ open }: { open: () => void }) {
  useOpenFromUrl(open);
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

describe('useOpenFromUrl', () => {
  it('?new=1 → mở một lần rồi bỏ tham số, giữ tham số khác', () => {
    const open = vi.fn();
    renderWithI18n(
      <MemoryRouter initialEntries={['/devices?q=abc&new=1']}>
        <Probe open={open} />
      </MemoryRouter>,
    );
    expect(open).toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/devices?q=abc');
  });

  it('không có tham số thì không mở', () => {
    const open = vi.fn();
    renderWithI18n(
      <MemoryRouter initialEntries={['/devices?q=abc']}>
        <Probe open={open} />
      </MemoryRouter>,
    );
    expect(open).not.toHaveBeenCalled();
  });
});
