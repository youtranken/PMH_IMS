import type { ReactNode } from 'react';

/**
 * Thanh hành động của trang chi tiết (AD-15), dính đáy màn trên điện thoại.
 *
 * Trang chi tiết dài; trên điện thoại nút chính ("Duyệt", "Xem", "Gia hạn") nằm tận cuối
 * trang hoặc bị thanh công cụ Safari che. Thanh này dính đáy khung cuộn ở ≤640px, chừa vùng an
 * toàn iOS (`env(safe-area-inset-bottom)`), xếp nút dọc rộng hết và đẩy nút `.primary`/
 * `.danger` xuống dưới cùng, cao 48px. Desktop: một hàng nút căn phải, không dính.
 *
 * Con trực tiếp nên là `<button>` (kiểu dáng mobile bám `> button`). Đặt ở CUỐI nội dung
 * trang, không đặt trong hộp thoại — hộp thoại đã có chân dính riêng (`Dialog` `footer`).
 */
export function StickyActionBar({
  ariaLabel,
  children,
}: {
  /** Tên nhóm cho trình đọc màn hình, vd "Thao tác với yêu cầu này". */
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="sticky-action-bar" role="group" aria-label={ariaLabel}>
      {children}
    </div>
  );
}
