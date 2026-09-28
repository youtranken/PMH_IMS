import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { THEME_EVENT, currentTheme, toggleTheme } from '@/lib/theme';

/**
 * Nút đổi giao diện sáng/tối. Toàn bộ màu đổi theo token (AD-15) — component khác
 * không cần biết đang ở theme nào.
 */
export function ThemeSwitch() {
  const { t } = useTranslation();
  const [theme, setThemeState] = useState(currentTheme());
  // Đổi ở Hồ sơ / menu tài khoản thì biểu tượng ở đây phải đổi theo.
  useEffect(() => {
    const sync = () => setThemeState(currentTheme());
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);
  const toDark = theme !== 'dark';
  return (
    <button
      type="button"
      // Cùng lớp `.icon-btn` với nút menu và nút tìm: ba nút cạnh nhau một cỡ, một nét.
      className="icon-btn"
      onClick={() => setThemeState(toggleTheme())}
      title={toDark ? t('theme.dark') : t('theme.light')}
      aria-label={toDark ? t('theme.switchToDark') : t('theme.switchToLight')}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {toDark ? (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </svg>
    </button>
  );
}
