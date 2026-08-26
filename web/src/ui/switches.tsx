import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentTheme, toggleTheme } from '@/lib/theme';

/**
 * Nút đổi giao diện sáng/tối. Toàn bộ màu đổi theo token (AD-15) — component khác
 * không cần biết đang ở theme nào.
 */
export function ThemeSwitch() {
  const { t } = useTranslation();
  const [theme, setThemeState] = useState(currentTheme());
  const toDark = theme !== 'dark';
  return (
    <button
      type="button"
      className="btn ghost sm"
      onClick={() => setThemeState(toggleTheme())}
      title={toDark ? t('theme.dark') : t('theme.light')}
      aria-label={toDark ? t('theme.switchToDark') : t('theme.switchToLight')}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
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
