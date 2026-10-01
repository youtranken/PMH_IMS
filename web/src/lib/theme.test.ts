import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setThemePreference, themePreference } from './theme';

const INIT_SRC = readFileSync(join(__dirname, '../../public/theme-init.js'), 'utf8');

/** Chạy đúng file `public/theme-init.js` mà index.html nạp trước khi React render. */
function runInit(): string | undefined {
  delete document.documentElement.dataset.theme;
  new Function(INIT_SRC)();
  return document.documentElement.dataset.theme;
}

function stubSystemDark(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: dark, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
}

beforeEach(() => stubSystemDark(false));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('theme mặc định là TỐI (Q-21)', () => {
  it('chưa lưu gì: tối, kể cả khi máy đang để sáng', () => {
    expect(runInit()).toBe('dark');
    expect(themePreference()).toBe('dark');
  });

  it('kho bị chặn: vẫn tối, không rơi về nền sáng mặc định của CSS', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(runInit()).toBe('dark');
    expect(themePreference()).toBe('dark');
  });

  it.each([
    ['light', false, 'light'],
    ['dark', false, 'dark'],
    ['system', false, 'light'],
    ['system', true, 'dark'],
  ] as const)('đã lưu %s (máy tối=%s) → %s', (saved, systemDark, applied) => {
    stubSystemDark(systemDark);
    localStorage.setItem('ims_theme', saved);
    expect(runInit()).toBe(applied);
    expect(themePreference()).toBe(saved);
  });

  it('chọn "Theo hệ thống" thì LƯU lựa chọn đó (không lưu = mặc định tối) và áp theo máy', () => {
    stubSystemDark(false);
    setThemePreference('system');
    expect(localStorage.getItem('ims_theme')).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');
    // Nạp lại trang: script đầu trang hiểu đúng lựa chọn vừa lưu.
    expect(runInit()).toBe('light');
  });
});
