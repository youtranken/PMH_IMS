/**
 * MỘT mũi tên duy nhất cho cả app (AD-15).
 *
 * Không dùng KÝ TỰ `›` `‹` theo cỡ chữ cho caret bung dòng hay nút phân trang: mảnh như dấu
 * ngoặc, ở 14px gần như không thấy, trên màn hình có scale nó lệch hẳn khỏi ô bấm, và đứng
 * cạnh SVG chevron của `Select` / `Combobox` / `DatePicker` thì trông không giống nhau chút nào.
 *
 * Mỗi component tự chép `<path>` thì sửa nét mũi tên phải sờ nhiều chỗ và chắc chắn sẽ có chỗ
 * bị quên. Nên một chỗ.
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
