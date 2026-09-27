import { useId, type ReactNode } from 'react';

/**
 * Lý do một nút đang bị khoá — gắn vào nút bằng `aria-describedby` (AD-15).
 *
 * `title=` một mình KHÔNG đủ: nó chỉ hiện khi rê chuột (bàn phím và màn cảm ứng không bao giờ
 * thấy), và trình đọc màn hình thường bỏ qua `title` của nút đã có tên. Người Tab tới một nút
 * xám mà không nghe lý do thì kết luận "mình không có quyền".
 *
 * Trả về props để trải lên nút (`aria-describedby` + `title` cho người dùng chuột) và một
 * phần tử `hint` mà nơi gọi đặt đâu đó trong cây. `visible: false` thì phần tử đó chỉ dành cho
 * trình đọc màn hình (`.sr-only`) — dùng khi lý do đã hiển nhiên bằng mắt (vd. ô chọn file
 * còn trống ngay phía trên), hoặc khi mỗi dòng của bảng có một nút riêng.
 */
export function useDisabledReason(
  reason: string | null | undefined,
  { visible = false }: { visible?: boolean } = {},
): {
  buttonProps: { 'aria-describedby'?: string; title?: string };
  hint: ReactNode;
} {
  const id = useId();
  if (!reason) return { buttonProps: {}, hint: null };
  return {
    buttonProps: { 'aria-describedby': id, title: reason },
    hint: (
      <span id={id} className={visible ? 'disabled-reason' : 'sr-only'}>
        {reason}
      </span>
    ),
  };
}
