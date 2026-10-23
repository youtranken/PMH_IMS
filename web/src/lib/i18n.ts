import i18n, { type FormatterModule } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { formatCount } from '@/lib/format';
import vi from '@/locales/vi';

/**
 * Biến là số ĐẾM thì có dấu ngăn nghìn (PW-C11 / TX-42). Danh sách đóng chứ không "mọi số": năm,
 * số phiên bản, cổng, số thứ tự ghế là mã — "2.026" hay "cổng 8.080" là sai. Số nhiều của i18next
 * đọc `count` gốc trong options, không đọc chuỗi đã định dạng, nên không lệch.
 */
const COUNT_KEYS = new Set([
  'count', 'total', 'used', 'free', 'days', 'done', 'seats', 'created', 'updated',
  'expired', 'upcoming', 'moved', 'reattached', 'hosts', 'owners', 'secrets', 'shown',
  'people', 'rules', 'scopes', 'adds', 'changes', 'issues', 'divisions', 'missed', 'signed',
]);

/**
 * Module formatter riêng chứ không `interpolation.format`: i18next luôn gắn Formatter mặc định đè
 * lên tuỳ chọn đó. Chuỗi trong `vi.ts` không dùng định dạng đặt tên (`{{x, fmt}}`), nên `add` /
 * `addCached` không cần làm gì.
 */
const countFormatter: FormatterModule = {
  type: 'formatter',
  init: () => undefined,
  add: () => undefined,
  addCached: () => undefined,
  // Trả lại đúng giá trị gốc cho biến không phải số đếm: i18next tự chuyển nó thành chuỗi như cũ.
  format: (value: unknown, _format, _lng, options) =>
    (typeof value === 'number' && Number.isInteger(value) && COUNT_KEYS.has(String(options?.interpolationkey))
      ? formatCount(value)
      : value) as string,
};

/**
 * UX-DR4: UI tiếng Việt. Giữ i18n (thay vì chuỗi cứng) vì bản in phiếu ISO là song ngữ —
 * thêm ngôn ngữ sau chỉ là thêm một file locale.
 */
void i18n
  .use(initReactI18next)
  .use(countFormatter)
  .init({
    resources: { vi: { translation: vi } },
    lng: 'vi',
    fallbackLng: 'vi',
    interpolation: { escapeValue: false, alwaysFormat: true },
  });

document.documentElement.lang = 'vi';

export default i18n;
