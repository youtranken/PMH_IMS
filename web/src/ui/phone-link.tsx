import type { ReactNode } from 'react';
import { formatPhone, telHref } from '@/lib/phone-format';

/**
 * Số điện thoại để BẤM GỌI (Q-18): chữ hiện tách nhóm cho dễ đọc, `tel:` giữ số liền. Mọi
 * chỗ in số điện thoại dùng component này — tự dựng `<a href="tel:…">` ở từng màn là lặp lại
 * luật tách nhóm và chắc chắn có chỗ quên.
 */
export function PhoneLink({
  value,
  className = 'mono',
  children,
}: {
  value: string;
  className?: string;
  /** Chữ riêng cho link (vd "Gọi tổng đài 1900 6600"); mặc định là số đã tách nhóm. */
  children?: ReactNode;
}) {
  return (
    <a className={className} href={telHref(value)}>
      {children ?? formatPhone(value)}
    </a>
  );
}
