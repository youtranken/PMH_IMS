import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { Field } from '@/ui/page-header';

/**
 * Hộp ghi một lý do BẮT BUỘC trước một lượt duyệt / trả lại / xin mở lại. Nút xác nhận khoá tới khi
 * có chữ — lý do trống thì API cũng từ chối. Nơi gọi tự chạy lệnh và báo lỗi (`onConfirm` đồng bộ,
 * `busy` do nơi gọi giữ).
 */
export function ReasonDialog({
  title,
  label,
  hint,
  confirmLabel,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  label: string;
  hint?: string;
  confirmLabel: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const formId = useId();
  const fieldId = `${formId}-reason`;
  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!busy}
      guardUnsaved
      title={title}
      footer={
        <>
          <DialogCancel disabled={busy}>{t('common.cancel')}</DialogCancel>
          <button type="submit" form={formId} className="btn primary" disabled={busy || !reason.trim()}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) onConfirm(reason.trim());
        }}
      >
        <Field label={label} required hint={hint} htmlFor={fieldId}>
          <textarea id={fieldId} className="inp" rows={4} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
