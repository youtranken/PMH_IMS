import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface SegmentedRadioOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/**
 * Dải nút `.segmented` chọn MỘT trong nhiều (lọc theo trạng thái, kiểu xem, giao thức) theo
 * mẫu radiogroup của ARIA: trình đọc màn hình đọc "đã chọn, 2 trên 3", Tab dừng MỘT lần ở
 * lựa chọn đang bật, mũi tên/Home/End đi trong nhóm và chọn luôn.
 *
 * Bấm lại lựa chọn đang bật vẫn gọi `onChange(cùng giá trị)`: bộ lọc kiểu "Tháng này" dùng
 * đó để bỏ lọc. Nút bật/tắt độc lập (chọn nhiều, hoặc một công tắc lẻ) KHÔNG dùng component
 * này — chúng là `aria-pressed` (xem `ChipToggleGroup`).
 */
export function SegmentedRadio<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: SegmentedRadioOption<T>[];
  /** Giá trị đang chọn; không khớp lựa chọn nào = chưa chọn gì. */
  value: T | '';
  onChange: (value: T) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = options.findIndex((option) => option.value === value);
  const firstEnabled = options.findIndex((option) => !option.disabled);
  // Chưa chọn gì thì lựa chọn dùng được đầu tiên giữ cửa Tab, không thì cả nhóm bị bỏ qua.
  const tabStop = checkedIndex >= 0 ? checkedIndex : firstEnabled;

  const move = (from: number, step: number | 'first' | 'last') => {
    const total = options.length;
    const order =
      step === 'first'
        ? options.map((_, i) => i)
        : step === 'last'
          ? options.map((_, i) => total - 1 - i)
          : Array.from({ length: total - 1 }, (_, k) => (from + step * (k + 1) + total * total) % total);
    const next = order.find((i) => !options[i].disabled);
    if (next === undefined) return;
    refs.current[next]?.focus();
    onChange(options[next].value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : event.key === 'Home'
            ? 'first'
            : event.key === 'End'
              ? 'last'
              : null;
    if (step === null) return;
    event.preventDefault();
    move(index, step);
  };

  return (
    <div
      className={className ? `segmented ${className}` : 'segmented'}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="radio"
          aria-checked={index === checkedIndex}
          tabIndex={index === tabStop ? 0 : -1}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
