import type { ReactNode } from 'react';

export interface ChipToggleOption {
  value: string;
  label: ReactNode;
}

/**
 * Bật/tắt một giá trị, trả về theo THỨ TỰ của danh sách lựa chọn chứ không theo thứ tự bấm:
 * cùng một tập chọn phải ra cùng một chuỗi `?kinds=` để link chép đi và khoá cache khớp nhau.
 */
export function toggleChip(value: string[], key: string, order: string[]): string[] {
  const next = new Set(value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return order.filter((item) => next.has(item));
}

/**
 * Nhóm nút bật/tắt chọn NHIỀU giá trị (vd lọc "SSL + Tên miền" cùng lúc). Không chọn gì =
 * "Tất cả" — nút đầu nhóm bật, bấm nó là gỡ mọi lựa chọn.
 *
 * Dùng `aria-pressed` chứ không phải ô tick: đây là bộ lọc áp ngay, không phải ô của một form
 * chờ bấm Lưu. Cùng kiểu dáng `.segmented`, dải nút quá rộng thì cuộn ngang trong chính nó.
 */
export function ChipToggleGroup({
  label,
  allLabel,
  options,
  value,
  onChange,
}: {
  /** Tên nhóm cho trình đọc màn hình. */
  label: string;
  allLabel: string;
  options: ChipToggleOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const order = options.map((option) => option.value);
  return (
    <div className="segmented" role="group" aria-label={label}>
      <button type="button" aria-pressed={value.length === 0} onClick={() => onChange([])}>
        {allLabel}
      </button>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value.includes(option.value)}
          onClick={() => onChange(toggleChip(value, option.value, order))}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
