/**
 * MỘT mũi tên duy nhất cho cả app (AD-15).
 *
 * Trước đây có hai loại đứng cạnh nhau và trông không giống nhau chút nào:
 *  - `Select` / `Combobox` / `DatePicker` vẽ SVG chevron 1rem, nét 2.4 — rõ, bấm trúng.
 *  - Caret bung dòng và nút phân trang lại dùng KÝ TỰ `›` `‹` theo cỡ chữ — mảnh như dấu
 *    ngoặc, ở 14px gần như không thấy, và trên màn hình có scale nó lệch hẳn khỏi ô bấm.
 *
 * Ba bản copy của cùng một `<path>` cũng đã nằm sẵn trong `select`/`combobox`/`date-picker` —
 * sửa nét mũi tên phải sờ ba chỗ và chắc chắn sẽ có chỗ bị quên. Giờ một chỗ.
 *
 * Kích thước theo `1em` để nó lớn/nhỏ theo `font-size` của nút bọc ngoài; nơi nào cần to hơn
 * thì đặt `font-size` cho nút, không sửa ở đây.
 */
export type ChevronDirection = 'down' | 'up' | 'left' | 'right';

/** Góc xoay so với bản gốc (chỉ xuống). Xoay chứ không vẽ bốn `path` — cùng một nét. */
const ROTATE: Record<ChevronDirection, number> = { down: 0, up: 180, right: -90, left: 90 };

export function Chevron({
  direction = 'down',
  className,
}: {
  direction?: ChevronDirection;
  className?: string;
}) {
  return (
    <svg
      className={['chevron', className].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={ROTATE[direction] ? { transform: `rotate(${ROTATE[direction]}deg)` } : undefined}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
