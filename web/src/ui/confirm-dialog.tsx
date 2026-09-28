import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogTitle, DialogDescription, DialogClose } from '@/ui/dialog';

/**
 * Hộp thoại xác nhận dùng chung — thay window.confirm cho các thao tác nguy hiểm
 * (vd Xóa vĩnh viễn). Dựng trên Radix Dialog (ui/dialog.tsx): focus trap, scroll-lock,
 * Esc, trả focus, aria-labelledby đều có sẵn. Nút xác nhận đỏ khi danger.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  error,
  checkbox,
  checked = false,
  onCheckedChange,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  /**
   * Một lựa chọn PHỤ đi kèm việc đang xác nhận — vd "Dọn hết thứ liên quan" khi thanh lý máy.
   *
   * Cố ý chỉ nhận MỘT ô, không nhận danh sách: hộp xác nhận là chỗ người ta đọc một câu rồi
   * quyết định. Nhét một cái form vào đây là biến nó thành màn nhập liệu, và lúc đó thứ cần
   * dựng là một Dialog riêng chứ không phải nới cái này rộng ra.
   */
  checkbox?: { label: string; hint?: string };
  checked?: boolean;
  onCheckedChange?: (next: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  return (
    <Dialog
      open
      // Đóng qua Esc / click-ngoài / nút ✕ → onCancel; chặn khi đang busy.
      onOpenChange={(o) => {
        if (!o && !busy) onCancel();
      }}
      dismissible={!busy}
      maxWidth={440}
    >
      <div className="sheet-header">
        <DialogTitle className="sheet-title">{title}</DialogTitle>
        <span className="spacer" />
        <DialogClose asChild>
          <button
            type="button"
            className="sheet-close"
            aria-label={cancelLabel ?? t('common.cancel')}
            disabled={busy}
          >
            ✕
          </button>
        </DialogClose>
      </div>
      <div className="sheet-body">
        {error && <p role="alert" className="alert error">{error}</p>}
        <DialogDescription style={{ margin: 0 }}>{message}</DialogDescription>
        {checkbox && (
          <>
            {/* Nhãn và câu hệ quả ĐƯỢC xuống dòng: câu hệ quả ("không hoàn tác được") là
                câu quan trọng nhất hộp này, cắt nó ra ngoài mép hộp là mất đúng thứ phải đọc.
                Câu hệ quả nằm NGOÀI `<label>` để tên ô tick vẫn gọn; trình đọc màn hình đọc
                nó qua `aria-describedby`. */}
            <label className="confirm-check">
              <input
                type="checkbox"
                checked={checked}
                disabled={busy}
                aria-describedby={checkbox.hint ? hintId : undefined}
                onChange={(e) => onCheckedChange?.(e.target.checked)}
              />
              <span>{checkbox.label}</span>
            </label>
            {checkbox.hint && (
              <p id={hintId} className="confirm-check-hint">
                {checkbox.hint}
              </p>
            )}
          </>
        )}
      </div>
      {/*
        `data-testid` PHẢI có ở đây nữa, không chỉ ở `dialog.tsx`.

        Hộp xác nhận không đi qua prop `footer` của `Dialog` mà tự dựng chân hộp của mình —
        nên có HAI nơi sinh ra `.sheet-footer`, và một `data-testid` đặt ở một nơi thì
        `confirmAction()` của bộ E2E chỉ tìm thấy một nửa số hộp. Đúng loại "một khái niệm,
        hai bản dựng" mà AD-15 sinh ra để chặn; ở đây giữ hai bản là có chủ ý (hộp xác nhận có
        bố cục riêng), nên cái phải giữ đồng bộ là cái tên.
      */}
      <div className="sheet-footer" data-testid="dialog-footer">
        <span className="spacer" />
        <button type="button" disabled={busy} onClick={onCancel}>
          {cancelLabel ?? t('common.cancel')}
        </button>
        <button
          type="button"
          className={danger ? 'danger' : 'primary'}
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
