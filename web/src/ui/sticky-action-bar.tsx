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
  children,
}: {
  /** Tên nhóm cho trình đọc màn hình — vd "Quyết định". */
  label: string;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="sticky-action-bar" role="group" aria-label={label}>
      {note ? <p className="sticky-action-note">{note}</p> : null}
      {children ? <div className="sticky-action-buttons">{children}</div> : null}
    </div>
  );
}
