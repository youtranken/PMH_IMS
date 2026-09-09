import * as RD from '@radix-ui/react-dialog';
import { createContext, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

/**
 * Nơi các popover (DatePicker/TimeField/Combobox/Select) portal VÀO khi mở trong dialog.
 * Radix Dialog dùng react-remove-scroll + body{pointer-events:none} chỉ cho phép tương tác
 * TRONG Content; popover portal ra document.body sẽ bị chặn click LẪN cuộn (bánh xe giờ).
 * Portal vào mount-point này (nằm trong Content) → thuộc vùng cho phép. Ngoài dialog = null → body.
 */
const DialogPortalContext = createContext<HTMLElement | null>(null);
export const useDialogPortal = () => useContext(DialogPortalContext);

/**
 * Khung modal dùng chung trên Radix Dialog — thay các khối .modal-backdrop/.sheet
 * copy tay (mỗi dialog một bản). Radix lo focus trap, scroll-lock, Esc, trả focus,
 * aria-modal + aria-labelledby (qua DialogTitle) — thứ 8 modal cũ đều thiếu.
 *
 * Giữ NGUYÊN class .sheet cũ để giao diện y hệt: Overlay = nền mờ (.modal-backdrop),
 * .dialog-viewport canh giữa bằng grid (như .modal-backdrop cũ từng bọc .sheet) nên
 * .sheet vẫn dùng animation modalIn (transform) mà không đụng nhau.
 */
export const DialogTitle = RD.Title;
export const DialogDescription = RD.Description;
export const DialogClose = RD.Close;

export function Dialog({
  open,
  onOpenChange,
  dismissible = true,
  className = 'sheet',
  overlayClassName = 'modal-backdrop',
  maxWidth,
  title,
  footer,
  closeLabel,
  children,
}: {
  /**
   * Tiêu đề hộp. Truyền vào là `Dialog` TỰ DỰNG khung ba phần (header có nền riêng + thân
   * cuộn được + chân dính đáy) — đúng thứ CSS `.sheet-*` đã có sẵn từ đầu nhưng gần như
   * không nơi nào dùng, khiến tiêu đề dính mép trên và ô nhập chạm mép trái.
   *
   * Không truyền → giữ nguyên hành vi cũ (children đổ thẳng vào `.sheet`), để những hộp có
   * bố cục riêng không bị ép khuôn.
   */
  title?: ReactNode;
  /** Hàng nút chân hộp. Tự đẩy sang phải, tự tách khỏi phần thân bằng viền trên. */
  footer?: ReactNode;
  /** Nhãn trợ năng cho nút ✕ (mặc định "Đóng"). */
  closeLabel?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // false = chặn đóng bằng Esc/click-ngoài (vd đang busy) — nút đóng tự disable.
  dismissible?: boolean;
  // Class hộp nội dung: 'sheet' (header/body/footer) hoặc 'modal' (hộp gọn), + biến thể.
  className?: string;
  // Class nền mờ. Dialog LỒNG (vd cascade trên form) dùng 'modal-backdrop bare' để
  // không dim đôi (form đã dim trang rồi).
  overlayClassName?: string;
  maxWidth?: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const block = dismissible ? undefined : (e: Event) => e.preventDefault();
  const [portalEl, setPortalEl] = useState<HTMLDivElement | null>(null);
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className={overlayClassName} />
        <div className="dialog-viewport">
          <RD.Content
            className={className}
            style={maxWidth ? { maxWidth } : undefined}
            onEscapeKeyDown={block}
            onPointerDownOutside={block}
            onInteractOutside={block}
          >
            <DialogPortalContext.Provider value={portalEl}>
              {title === undefined ? (
                children
              ) : (
                <>
                  <div className="sheet-header">
                    <RD.Title className="sheet-title">{title}</RD.Title>
                    <span className="spacer" />
                    <RD.Close asChild>
                      <button
                        type="button"
                        className="sheet-close"
                        /* KHÔNG dùng chung nhãn "Đóng" với nút ở chân hộp: hai nút cùng tên trong một
                           hộp thì trình đọc màn hình đọc "Đóng, nút" hai lần, không phân biệt được. */
                        aria-label={closeLabel ?? t('common.closeDialog')}
                        disabled={!dismissible}
                      >
                        ✕
                      </button>
                    </RD.Close>
                  </div>
                  <div className="sheet-body">{children}</div>
                  {footer ? (
                    <div className="sheet-footer" data-testid="dialog-footer">
                      <span className="spacer" />
                      {footer}
                    </div>
                  ) : null}
                </>
              )}
            </DialogPortalContext.Provider>
            {/* Mount-point cho popover portal vào (trong Content → tránh RRS chặn cuộn/click). */}
            <div ref={setPortalEl} />
          </RD.Content>
        </div>
      </RD.Portal>
    </RD.Root>
  );
}
