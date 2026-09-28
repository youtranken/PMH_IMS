import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  THEME_EVENT,
  setThemePreference,
  themePreference,
  type ThemePreference,
} from '@/lib/theme';

const OPTIONS: { value: ThemePreference; labelKey: string }[] = [
  { value: 'light', labelKey: 'profile.themeLight' },
  { value: 'dark', labelKey: 'profile.themeDark' },
  { value: 'system', labelKey: 'profile.themeSystem' },
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

/** Sáng / Tối / Theo hệ thống — dùng ở Hồ sơ của tôi và menu tài khoản. */
export function ThemeChoice({ label }: { label: string }) {
  const { t } = useTranslation();
  const pref = useThemePreference();
  return (
    <div className="segmented" role="group" aria-label={label}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={pref === option.value ? 'on' : undefined}
          aria-pressed={pref === option.value}
          onClick={() => setThemePreference(option.value)}
        >
          {t(option.labelKey)}
        </button>
      ))}
    </div>
  );
}
