import type { ReactNode } from 'react';
import { CheckIcon } from '@/ui/glyph-icons';

/**
 * Chip bật/tắt MỘT bộ lọc trong thanh lọc ("Chỉ cổng nhạy cảm", "Ẩn mục đã quá hạn"). Một kiểu cho
 * mọi màn: trước đây có chỗ là nút xám đặc (đang tắt trông như bị vô hiệu), có chỗ là chip trắng.
 * Ô tick `label.filter-check` trong thanh lọc mặc cùng vẻ này (CSS) — cùng một nghĩa, cùng một hình.
 *
 * Ô vuông nhỏ đứng trước chữ: trạng thái không nói bằng mỗi màu nền (WCAG 1.4.1).
 */
export function FilterToggle({
  pressed,
  onChange,
  children,
}: {
  pressed: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="filter-chip" aria-pressed={pressed} onClick={() => onChange(!pressed)}>
      <span className="filter-chip-box" aria-hidden="true">
        {pressed ? <CheckIcon /> : null}
      </span>
      {children}
    </button>
  );
}
