import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Bước tăng/giảm trên chữ của ô. Ô trống hoặc chữ không phải số: `+` ra `min` (điểm bắt đầu hợp
 * lệ), `−` giữ nguyên — đoán một con số từ chữ sai là âm thầm ghi đè thứ người dùng gõ.
 */
export function stepValue(raw: string, delta: 1 | -1, min: number, max?: number): string {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return delta > 0 ? String(min) : raw;
  const current = Number(text);
  const upper = max ?? Number.MAX_SAFE_INTEGER;
  // Đang ở dưới `min` (dữ liệu cũ) thì − không kéo sâu thêm, + nhảy thẳng lên `min`.
  if (current < min) return delta > 0 ? String(min) : raw;
  return String(Math.min(upper, Math.max(min, current + delta)));
}

/**
 * Ô số nguyên nhỏ có nút − / + (Q-24): số ghế license, số U.
 *
 * Ô chữ + `inputMode="numeric"`, không `type="number"`: ô số trả `value` rỗng khi gõ "10 ghế",
 * tức lặng lẽ thành "không giới hạn" — nơi gọi cần chữ thật để báo sai. Ô trống vẫn là một giá
 * trị hợp lệ do nơi gọi định nghĩa (số ghế trống = không giới hạn), nên − không xoá về trống.
 *
 * Nhận `id`/`aria-*` từ `Field` rồi chuyển xuống `<input>`; nút mang tên "Tăng/Giảm {label}".
 */
export function NumberStepper({
  value,
  onChange,
  min = 1,
  max,
  label,
  id,
  disabled,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  min?: number;
  max?: number;
  /** Danh từ cho tên nút: "số ghế" → "Tăng số ghế". */
  label: string;
  id?: string;
  disabled?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const { t } = useTranslation();
  const down = stepValue(value, -1, min, max);
  const up = stepValue(value, 1, min, max);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const next = event.key === 'ArrowUp' ? up : down;
    if (next !== value) onChange(next);
  };

  return (
    <span className="number-stepper">
      <button
        type="button"
        className="btn number-stepper-btn"
        aria-label={t('stepper.dec', { subject: label })}
        disabled={disabled || down === value}
        onClick={() => onChange(down)}
      >
        −
      </button>
      <input
        id={id}
        className="inp"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        onKeyDown={onKeyDown}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="btn number-stepper-btn"
        aria-label={t('stepper.inc', { subject: label })}
        disabled={disabled || up === value}
        onClick={() => onChange(up)}
      >
        +
      </button>
    </span>
  );
}
