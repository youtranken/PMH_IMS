const THEME_KEY = 'ims_theme'; // chỉ theme — KHÔNG token (AD-8)

export type Theme = 'light' | 'dark';
/** Lựa chọn của người dùng. 'system' = theo `prefers-color-scheme` của máy. */
export type ThemePreference = Theme | 'system';

const SYSTEM_DARK = '(prefers-color-scheme: dark)';

/** Phát khi theme đổi, để nút ở topbar và lựa chọn trong Hồ sơ không nói hai điều khác nhau. */
export const THEME_EVENT = 'ims-theme-change';

/** Theme đang áp (đọc từ <html data-theme> mà index.html đã set sớm chống chớp). */
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function setTheme(theme: Theme): void {
  setThemePreference(theme);
}

/** Chưa chọn gì thì dùng giao diện tối (Q-21). */
const DEFAULT_THEME: Theme = 'dark';

/**
 * Lựa chọn đang lưu. Không có khoá (hoặc kho bị chặn) = mặc định tối; "Theo hệ thống" lưu hẳn
 * chữ 'system'. Đúng quy ước mà `public/theme-init.js` đọc lúc tải trang — hai nơi phải hiểu
 * giống nhau, không thì trang chớp sang theme khác khi React lên.
 */
export function themePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'dark' || saved === 'light' || saved === 'system' ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function setThemePreference(pref: ThemePreference): void {
  const theme: Theme =
    pref === 'system' ? (window.matchMedia(SYSTEM_DARK).matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // storage bị chặn thì vẫn đổi theme phiên hiện tại
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
