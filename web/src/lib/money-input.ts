/**
 * Ô nhập tiền đồng. Màn hình hiện "5.600.000 ₫", hoá đơn in "5,600,000", người ta nói "5,6
 * triệu" — ô nhập phải nhận cả ba, không bắt gõ lại thành một dãy số trần.
 *
 * Trả MỘT hình dạng `{ value, reason }` (tsconfig web không bật `strict`). `value` null + reason
 * null = ô trống (chưa khai, KHÁC 0 ₫).
 */
export function parseMoneyInput(raw: string): {
  value: number | null;
  reason: 'invalid' | null;
} {
  const text = raw.trim().toLowerCase().replace(/\s*(₫|đ|vnd|vnđ)$/u, '').trim();
  if (text === '') return { value: null, reason: null };

  // "5,6tr", "12 triệu", "350k": số thập phân (chấm hoặc phẩy) nhân đơn vị.
  const unit = /^(\d+(?:[.,]\d+)?)\s*(tr|triệu|trieu|k|nghìn|nghin)$/u.exec(text);
  if (unit) {
    const base = Number(unit[1].replace(',', '.'));
    const factor = unit[2].startsWith('k') || unit[2].startsWith('ngh') ? 1_000 : 1_000_000;
    return { value: Math.round(base * factor), reason: null };
  }

  // Số nguyên, có thể có dấu nhóm nghìn (chấm, phẩy hoặc cách) đúng nhóm ba chữ số.
  const compact = text.replace(/\s+/g, ' ');
  if (/^\d+$/.test(compact)) return { value: Number(compact), reason: null };
  if (/^\d{1,3}([.,\s])\d{3}(\1\d{3})*$/.test(compact)) {
    return { value: Number(compact.replace(/[.,\s]/g, '')), reason: null };
  }
  return { value: null, reason: 'invalid' };
}

const groupFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

/** Số → chữ trong ô ("5.600.000"); ký hiệu ₫ là hậu tố cố định bên cạnh ô, không nằm trong chữ. */
export function formatMoneyInput(value: number | null): string {
  return value === null ? '' : groupFmt.format(value);
}
