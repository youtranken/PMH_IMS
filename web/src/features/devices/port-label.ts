const COLLATOR = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

/** Sắp cổng theo thứ tự tự nhiên (Gi1/0/2 trước Gi1/0/10) — bản sao, không đổi mảng gốc. */
export function sortByPortLabel<T extends { portLabel: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => COLLATOR.compare(a.portLabel, b.portLabel));
}

/**
 * Nhãn cổng kế tiếp: tăng số CUỐI của nhãn, giữ độ rộng nếu có số 0 đứng đầu ("eth09" →
 * "eth10"). Nhãn không kết thúc bằng số thì không đoán — trả `''` để người dùng tự gõ.
 */
export function nextPortLabel(label: string): string {
  const match = /^(.*?)(\d+)$/.exec(label.trim());
  if (!match) return '';
  const digits = match[2];
  const next = String(Number(digits) + 1).padStart(digits.length, '0');
  return `${match[1]}${next}`;
}
