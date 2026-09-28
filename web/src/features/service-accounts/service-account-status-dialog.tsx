import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { textRule, useFormErrors } from '@/ui/use-form-errors';
import type { ServiceAccountRow, ServiceAccountStatus } from './service-account-types';

/**
 * Đổi trạng thái kèm LÝ DO — đường duy nhất đóng, và cũng là đường duy nhất mở lại.
 *
 * Cùng khuôn với hộp gỡ rule NAT: "tài khoản này đóng ngày nào, ai đóng, vì sao" là câu sáu
 * tháng sau sẽ có người hỏi, và chỉ dòng lịch sử trả lời được. Mở lại cũng vậy: bật lại một
 * tài khoản dùng chung đã bị đóng là một quyết định, không phải một lần sửa ô.
 *
 * MỘT hộp cho hai chiều và hai nơi gọi (danh sách + trang hồ sơ): khác nhau đúng ba thứ —
 * endpoint, nhãn, tông nút.
 */
export function ServiceAccountStatusDialog({
  row,
  next,
  csrfToken,
  onClose,
  onDone,
}: {
  row: Pick<ServiceAccountRow, 'id' | 'code'>;
  /** Trạng thái SẼ tới, không phải trạng thái đang có. */
  next: ServiceAccountStatus;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const off = next === 'disabled';
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const check = useFormErrors({ reason: textRule(t, reason, 3) });
  const change = useApiMutation<{ reason: string }, unknown>(
    `/api/v1/service-accounts/${row.id}/${off ? 'disable' : 'enable'}`,
    { method: 'PATCH', csrfToken, refreshMe: false },
  );
  const label = off ? t('serviceAccounts.disable') : t('serviceAccounts.enable');

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ.
         `guardUnsaved`: chưa bấm Lưu mà lỡ Esc thì hỏi lại, đừng xoá trắng. */
      dismissible={!change.isPending}
      guardUnsaved
      maxWidth={480}
      title={`${label} — ${row.code}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="sa-status-form"
            className={off ? 'btn danger' : 'btn primary'}
            disabled={change.isPending}
          >
            {change.isPending ? t('common.loading') : label}
          </button>
        </>
      }
    >
      <form
        id="sa-status-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          change.mutate(
            { reason: reason.trim() },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">
          {off ? t('serviceAccounts.disableHint') : t('serviceAccounts.enableHint')}
        </p>
        <Field
          label={off ? t('serviceAccounts.disableReason') : t('serviceAccounts.enableReason')}
          required
          htmlFor="sa-status-reason"
          error={check.error('reason')}
        >
          <input
            id="sa-status-reason"
            className="inp"
            required
            minLength={3}
            placeholder={
              off
                ? t('serviceAccounts.disableReasonPlaceholder')
                : t('serviceAccounts.enableReasonPlaceholder')
            }
            value={reason}
            onChange={(e) => setReason(e.target.value)}
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
