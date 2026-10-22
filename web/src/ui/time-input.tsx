import type { InputHTMLAttributes } from 'react';

/**
 * Gõ giờ bằng bàn phím số (FM-15): đủ hai số giờ thì tự chèn ":"; xoá lùi hay tự gõ ":" thì để
 * nguyên, ":" gõ ngay sau dấu tự chèn bị nuốt.
 */
export function maskTimeTyping(prev: string, next: string): string {
  if (next.length <= prev.length) return next;
  if (prev.endsWith(':') && next === `${prev}:`) return prev;
  return /^\d{2}$/.test(next) ? `${next}:` : next;
}

/**
 * Ô GIỜ dùng chung (FM-15 / DS-28): chữ `hh:mm` 24 giờ, cao như mọi ô nhập. `<input type="time">`
 * hiện "--:-- --" kiểu 12 giờ AM/PM theo máy, cao lệch ô bên cạnh và khác kiểu DatePicker. Giá
 * trị vẫn là chuỗi `HH:MM` như ô native, nơi gọi tự kiểm.
 */
export function TimeInput({
  value,
  onChange,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="hh:mm"
      maxLength={5}
      className={className ? `inp time-input ${className}` : 'inp time-input'}
      value={value}
      onChange={(event) => onChange(maskTimeTyping(value, event.target.value))}
      {...props}
    />
  );
}
