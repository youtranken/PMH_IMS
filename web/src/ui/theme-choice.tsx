import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  THEME_EVENT,
  setThemePreference,
  themePreference,
  type ThemePreference,
} from '@/lib/theme';
import { MonitorIcon, MoonIcon, SunIcon } from '@/ui/glyph-icons';

const OPTIONS: { value: ThemePreference; labelKey: string; Icon: typeof SunIcon }[] = [
  { value: 'light', labelKey: 'profile.themeLight', Icon: SunIcon },
  { value: 'dark', labelKey: 'profile.themeDark', Icon: MoonIcon },
  { value: 'system', labelKey: 'profile.themeSystem', Icon: MonitorIcon },
];

/**
 * Lựa chọn đang lưu, cập nhật khi nơi khác đổi (nút ở topbar) và — khi đang "Theo hệ thống" —
 * khi máy tự chuyển sáng/tối theo giờ.
 */
export function useThemePreference(): ThemePreference {
  const [pref, setPref] = useState<ThemePreference>(() => themePreference());
  useEffect(() => {
    const sync = () => setPref(themePreference());
    window.addEventListener(THEME_EVENT, sync);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystem = () => {
      if (themePreference() === 'system') setThemePreference('system');
    };
    mq.addEventListener('change', onSystem);
    return () => {
      window.removeEventListener(THEME_EVENT, sync);
      mq.removeEventListener('change', onSystem);
    };
  }, []);
  return pref;
}

/**
 * Sáng / Tối / Theo hệ thống — dùng ở Hồ sơ của tôi (biểu tượng + chữ) và menu tài khoản
 * (`compact`: một hàng ba nút chỉ biểu tượng, tên ở `aria-label` + tooltip `title`).
 *
 * `inMenu`: nút mang vai `menuitemradio` + `aria-checked` và `tabIndex=-1` để menu tài khoản
 * tự lo phím mũi tên (WAI-ARIA menu); ngoài menu là nút bật `aria-pressed`.
 */
export function ThemeChoice({
  label,
  compact = false,
  inMenu = false,
}: {
  label: string;
  compact?: boolean;
  inMenu?: boolean;
}) {
  const { t } = useTranslation();
  const pref = useThemePreference();
  return (
    <div className={compact ? 'theme-choice compact' : 'segmented theme-choice'} role="group" aria-label={label}>
      {OPTIONS.map(({ value, labelKey, Icon }) => {
        const name = t(labelKey);
        const on = pref === value;
        return (
          <button
            key={value}
            type="button"
            className={on ? 'on' : undefined}
            {...(inMenu
              ? { role: 'menuitemradio', 'aria-checked': on, tabIndex: -1 }
              : { 'aria-pressed': on })}
            aria-label={compact ? name : undefined}
            title={compact ? name : undefined}
            onClick={() => setThemePreference(value)}
          >
            <Icon />
            {compact ? null : name}
          </button>
        );
      })}
    </div>
  );
}
