import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { Field } from '@/ui/page-header';

/**
 * Hộp ghi lý do BẮT BUỘC của luồng kỳ (Q-28): trả lại kỳ, xin mở lại, từ chối mở lại. Dựng trên
 * `Dialog` dùng chung; nút xác nhận khoá tới khi có chữ — lý do trống thì API cũng từ chối.
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
          <button type="submit" form="iso-reason-form" className="btn primary" disabled={busy || !reason.trim()}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <form
        id="iso-reason-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) onConfirm(reason.trim());
        }}
      >
        <Field label={label} required hint={hint} htmlFor="iso-reason">
          <textarea id="iso-reason" className="inp" rows={4} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
