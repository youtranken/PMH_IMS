import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DialogPortalContext, useDialogPortal } from '@/ui/dialog';
import { useAnchoredMenu } from '@/ui/use-anchored-menu';

/**
 * Nút mở một hộp nổi GỌN neo vào chính nó (không modal): hộp tìm trên thanh mảnh của màn sơ đồ
 * ("Thiết bị kho", "Chèn tủ"…) — Q-23: chức năng phụ của màn tràn mở
 * dạng hộp gọn từ thanh trên, KHÔNG chiếm một cột cố định và không che cả trình vẽ.
 *
 * Đóng bằng Esc, bấm ra ngoài, hoặc khi tiêu điểm rời cửa sổ (bấm vào iframe trình vẽ không bắn
 * `mousedown` lên trang IMS — chỉ `blur` của cửa sổ báo được cú bấm đó). Mở thì tiêu điểm vào ô
 * nhập đầu tiên trong hộp; đóng thì trả về nút.
 *
 * `anchor`: hộp KHÔNG vẽ nút riêng mà neo vào phần tử đã cho — hộp mở từ một mục của menu ⋮ trên
 * thanh mảnh (Q-18, Q-23: thanh chỉ giữ việc chính, phần còn lại vào menu); mục menu biến mất khi
 * menu đóng nên không neo vào nó được. Esc trả tiêu điểm về nút trong điểm neo.
 *
 * Không dùng cho việc cần xác nhận/nhập form nhiều bước — đó là `Dialog`.
 */
export function Popover({
  label,
  title,
  open,
  onOpenChange,
  disabled,
  buttonClassName = 'btn',
  hint,
  anchor,
  children,
}: {
  /** Chữ trên nút mở. */
  label: ReactNode;
  /** Tên trợ năng của hộp (role="dialog", không modal). */
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  buttonClassName?: string;
  /** Câu giải thích của nút mở, chỉ hiện khi rê chuột (`title`). */
  hint?: string;
  /** Có (kể cả `null` lúc điểm neo chưa gắn) = không vẽ nút; hộp neo vào phần tử này. */
  anchor?: HTMLElement | null;
  children: ReactNode;
}) {
  const id = useId();
  const portal = useDialogPortal();
  /*
   * Menu của ô chọn trong hộp (lọc site, chọn tủ) portal vào điểm neo NẰM TRONG hộp: portal ra
   * `document.body` thì cú bấm chọn mục là "bấm ra ngoài" và hộp đóng mất giữa chừng.
   */
  const [menuAnchor, setMenuAnchor] = useState<HTMLDivElement | null>(null);
  const { refs, floatingStyles } = useAnchoredMenu(open, { placement: 'bottom-start', maxHeight: 520 });
  const latest = useRef(onOpenChange);
  useEffect(() => {
    latest.current = onOpenChange;
  });
  const anchored = anchor !== undefined;
  useEffect(() => {
    if (anchored) refs.setReference(anchor ?? null);
  }, [anchored, anchor, refs]);

  useEffect(() => {
    if (!open) return undefined;
    const panel = refs.floating.current;
    const first = panel?.querySelector<HTMLElement>('input, select, textarea, button:not([disabled])');
    first?.focus();
    const close = () => latest.current(false);
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (refs.domReference.current?.contains(target) || refs.floating.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
      const reference = refs.domReference.current as HTMLElement | null;
      const back = reference?.matches('button, [tabindex]') ? reference : reference?.querySelector<HTMLElement>('button');
      back?.focus();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [open, refs.domReference, refs.floating]);

  return (
    <>
      {anchored ? null : (
        <button
          ref={refs.setReference}
          type="button"
          className={buttonClassName}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          disabled={disabled}
          title={hint}
          onClick={() => onOpenChange(!open)}
        >
          {label}
        </button>
      )}
      {open
        ? createPortal(
            <div id={id} ref={refs.setFloating} role="dialog" aria-label={title} className="popover-panel" style={floatingStyles}>
              <DialogPortalContext.Provider value={menuAnchor}>{children}</DialogPortalContext.Provider>
              <div ref={setMenuAnchor} />
            </div>,
            portal ?? document.body,
          )
        : null}
    </>
  );
}
