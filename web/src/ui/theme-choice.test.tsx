import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { ThemeChoice } from './theme-choice';

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

/** Màn Hồ sơ: ba nút có cả biểu tượng lẫn chữ, cùng bộ biểu tượng với nút ở topbar (Q-20). */
describe('ThemeChoice', () => {
  it('bản đầy đủ: mỗi nút có biểu tượng + chữ, nút đang chọn mang aria-pressed', async () => {
    renderWithI18n(<ThemeChoice label="Giao diện" />);
    const group = screen.getByRole('group', { name: 'Giao diện' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Sáng', 'Tối', 'Theo hệ thống']);
    for (const b of buttons) expect(b.querySelector('svg.glyph')).not.toBeNull();
    await userEvent.setup().click(within(group).getByRole('button', { name: 'Tối' }));
    expect(within(group).getByRole('button', { name: 'Tối' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('bản gọn: chỉ biểu tượng, tên đọc được qua aria-label và hiện tooltip qua title', () => {
    renderWithI18n(<ThemeChoice label="Giao diện" compact />);
    const buttons = within(screen.getByRole('group', { name: 'Giao diện' })).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Sáng', 'Tối', 'Theo hệ thống']);
    for (const b of buttons) {
      expect(b.textContent).toBe('');
      expect(b).toHaveAttribute('title', b.getAttribute('aria-label'));
    }
  });
});
