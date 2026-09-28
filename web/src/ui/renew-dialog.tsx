import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { useFormErrors } from '@/ui/use-form-errors';

/** Đủ để gia hạn một mục: `kind` + `id` là khoá của `POST /expiry/renew`. */
export interface RenewTarget {
  kind: string;
  id: string;
  label: string;
  /** Hạn hiện tại (YYYY-MM-DD) — hạn mới phải sau ngày này. */
  end: string;
}

/**
 * Hộp Gia hạn một mục có hạn (license, SSL, tên miền, hợp đồng…) qua `POST /expiry/renew`.
 *
 * Dùng chung cho màn `/expiry` và khối "Sắp hết hạn" của trang chủ (AD-15): hai bản riêng thì
 * một bên sẽ quên chặn Esc lúc đang ghi, hoặc quên `min` trên lịch. Nơi gọi chỉ mở hộp cho
 * dòng có `canRenew` — bảo hành thiết bị không gia hạn ở đây được.
 */
export function RenewDialog({
  row,
  kindLabel,
  csrfToken,
  onClose,
  onDone,
}: {
  row: RenewTarget;
  kindLabel: string;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const check = useFormErrors({ endDate: !endDate && t('expiry.pickDate') });
  const renew = useApiMutation<Record<string, unknown>, unknown>('/api/v1/expiry/renew', {
    csrfToken,
    refreshMe: false,
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ.
         `guardUnsaved`: chưa bấm Lưu mà lỡ Esc thì hỏi lại, đừng xoá trắng. */
      dismissible={!renew.isPending}
      guardUnsaved
      maxWidth={520}
      title={`${t('expiry.renew')} — ${row.label}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="renew-form" className="btn primary" disabled={renew.isPending}>
            {renew.isPending ? t('common.loading') : t('expiry.renew')}
          </button>
        </>
      }
    >
      <form
        id="renew-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          renew.mutate(
            { kind: row.kind, id: row.id, endDate },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">
          {kindLabel} · {t('expiry.end')}: {formatDate(row.end)}
        </p>
        <Field
          label={t('expiry.newEnd')}
          required
          hint={t('expiry.renewHint')}
          error={check.error('endDate')}
        >
          <DatePicker
            value={endDate}
            ariaLabel={t('expiry.newEnd')}
            /* Hạn mới phải sau hạn cũ — chặn trên lịch; API vẫn kiểm lại vì chốt chặn
               thật phải nằm ở server. */
            min={row.end}
            onChange={setEndDate}
          />
        </Field>

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
