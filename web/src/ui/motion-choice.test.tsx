import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { setMotionPreference } from '@/lib/motion';
import { MotionChoice } from './motion-choice';

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.motion;
});

/** Hồ sơ của tôi: "Hiệu ứng chuyển động" — Theo hệ thống / Luôn bật / Tắt (Q-21). */
describe('MotionChoice', () => {
  it('ba lựa chọn, mặc định Theo hệ thống; chọn Luôn bật → html[data-motion=on]', async () => {
    renderWithI18n(<MotionChoice />);
    const group = screen.getByRole('radiogroup', { name: 'Hiệu ứng chuyển động' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Theo hệ thống', 'Luôn bật', 'Tắt']);
    expect(within(group).getByRole('radio', { name: 'Theo hệ thống' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.setup().click(within(group).getByRole('radio', { name: 'Luôn bật' }));
    expect(document.documentElement.dataset.motion).toBe('on');
    expect(within(group).getByRole('radio', { name: 'Luôn bật' })).toHaveAttribute('aria-checked', 'true');
  });

  it('nơi khác đổi lựa chọn → hiển thị theo', () => {
    renderWithI18n(<MotionChoice />);
    act(() => setMotionPreference('off'));
    expect(screen.getByRole('radio', { name: 'Tắt' })).toHaveAttribute('aria-checked', 'true');
  });
});
