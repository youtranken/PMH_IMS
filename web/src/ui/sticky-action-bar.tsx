import type { ReactNode } from 'react';

/**
 * Thanh quyết định DÍNH ĐÁY cho màn mà việc chính là bấm một nút trên điện thoại.
 *
 * Nút cuối trang thì bị thanh công cụ dưới của Safari và vạch home che, và bị đẩy khỏi tầm nhìn
 * khi bàn phím mở. Dính đáy + đệm `safe-area-inset-bottom` giữ nút ở đúng chỗ ngón cái chạm
 * tới, và nút cao 48px để không bấm trượt.
 *
 * `note` là một dòng ngữ cảnh đứng trên hàng nút (vd "Cần người khác duyệt"). Con đặt thẳng
 * `<button className="btn …">`: nút `primary` tự chiếm phần rộng hơn.
 */
export function StickyActionBar({
  label,
  note,
  compact = false,
  children,
}: {
  /** Tên nhóm cho trình đọc màn hình — vd "Quyết định". */
  label: string;
  note?: ReactNode;
  /**
   * Màn cấu hình trên desktop (Tham số hệ thống): ghi chú bên trái, nút `btn sm` dồn phải cùng
   * một hàng — hai nút 48px kéo hết bề ngang là quá to cho việc lưu một nhóm tham số (Q-21).
   */
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={compact ? 'sticky-action-bar compact' : 'sticky-action-bar'} role="group" aria-label={label}>
      {note ? <p className="sticky-action-note">{note}</p> : null}
      {children ? <div className="sticky-action-buttons">{children}</div> : null}
    </div>
  );
}
