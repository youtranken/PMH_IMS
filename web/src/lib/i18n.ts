import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import vi from '@/locales/vi';

/**
 * UX-DR4: UI tiếng Việt. Giữ i18n (thay vì chuỗi cứng) vì bản in phiếu ISO là song ngữ —
 * thêm ngôn ngữ sau chỉ là thêm một file locale.
 */
void i18n.use(initReactI18next).init({
  resources: { vi: { translation: vi } },
  lng: 'vi',
  fallbackLng: 'vi',
  interpolation: { escapeValue: false },
});

document.documentElement.lang = 'vi';

export default i18n;
