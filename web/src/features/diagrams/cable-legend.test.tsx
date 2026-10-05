import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { CableLegend } from './cable-legend';

const TYPES = [{ id: 'c1', name: 'Cat6', colorSlot: 1, active: true }];

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

afterEach(() => vi.unstubAllGlobals());

describe('Chú giải dây nổi trên trình xem', () => {
  it('màn hẹp: thu thành nút "Chú giải dây", mặc định đóng (không che bản vẽ và nút thu phóng); bấm thì mở', async () => {
    narrow(true);
    renderWithI18n(<CableLegend cableTypes={TYPES} floating />);
    const toggle = screen.getByRole('button', { name: 'Chú giải dây' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Chú giải màu dây' })).toBeNull();
    await userEvent.setup().click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list', { name: 'Chú giải màu dây' })).toHaveTextContent('Cat6');
  });

  it('màn rộng: mặc định mở, vẫn thu lại được', async () => {
    narrow(false);
    renderWithI18n(<CableLegend cableTypes={TYPES} floating />);
    const toggle = screen.getByRole('button', { name: 'Chú giải dây' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list', { name: 'Chú giải màu dây' })).toBeInTheDocument();
    await userEvent.setup().click(toggle);
    expect(screen.queryByRole('list', { name: 'Chú giải màu dây' })).toBeNull();
  });

  it('chú giải trong hộp (không nổi): luôn mở, không có nút thu', () => {
    narrow(true);
    renderWithI18n(<CableLegend cableTypes={TYPES} />);
    expect(screen.queryByRole('button', { name: 'Chú giải dây' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Chú giải màu dây' })).toBeInTheDocument();
  });
});
