import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { THEME_EVENT, currentTheme, toggleTheme } from '@/lib/theme';
import { MoonIcon, SunIcon } from '@/ui/glyph-icons';

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
      {toDark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
