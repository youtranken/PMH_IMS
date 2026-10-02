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

describe('đổi theme không chạy hiệu ứng chuyển màu', () => {
  /*
   * Ô bảng, nút, menu có transition màu nền (Q-21). Đổi theme mà để transition chạy thì cả màn
   * mờ dần qua nhiều nhịp, và hai dòng cùng trạng thái đọc ra hai màu khác nhau giữa chừng
   * (E2E ui-shared "hai dòng quá hạn liền nhau"). Lúc đổi theme phải tắt transition một nhịp.
   */
  it('gắn data-theme-switching trong lúc đổi rồi gỡ ở khung hình kế', async () => {
    setThemePreference('light');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(document.documentElement.hasAttribute('data-theme-switching')).toBe(false);
    setThemePreference('dark');
    expect(document.documentElement.hasAttribute('data-theme-switching')).toBe(true);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(document.documentElement.hasAttribute('data-theme-switching')).toBe(false);
  });
});

describe('theme mặc định là SÁNG (Q-21)', () => {
  it('chưa lưu gì: sáng, kể cả khi máy đang để tối', () => {
    stubSystemDark(true);
    expect(runInit()).toBe('light');
    expect(themePreference()).toBe('light');
  });

  it('kho bị chặn: vẫn sáng, kể cả khi máy đang để tối', () => {
    stubSystemDark(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(runInit()).toBe('light');
    expect(themePreference()).toBe('light');
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

  it('chọn "Theo hệ thống" thì LƯU lựa chọn đó (không lưu = mặc định sáng) và áp theo máy', () => {
    stubSystemDark(false);
    setThemePreference('system');
    expect(localStorage.getItem('ims_theme')).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');
    // Nạp lại trang: script đầu trang hiểu đúng lựa chọn vừa lưu.
    expect(runInit()).toBe('light');
  });
});
