import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { reasonRule, useFormErrors } from '@/ui/use-form-errors';
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
  /*
   * Hai việc THẬT khi đóng một tài khoản (nhân viên nghỉ): khoá nó trên hệ thống gốc, và huỷ/xoay
   * mật khẩu trong két. IMS không tự làm được việc nào — nên nhắc, và việc nào đã làm thì ghi
   * luôn vào lý do để dòng lịch sử nói ra. Không bắt buộc: có khi đóng hồ sơ trước, khoá sau.
   */
  const [lockedAtSource, setLockedAtSource] = useState(false);
  const [secretHandled, setSecretHandled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = useFormErrors({ reason: reasonRule(t, reason) });
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
          <DialogCancel>
            {t('common.cancel')}
          </DialogCancel>
          <button
            type="submit"
            form="sa-status-form"
            className={off ? 'btn danger' : 'btn primary'}
            disabled={change.isPending}
          >
            {change.isPending ? t('common.working') : label}
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
          const done = [
            off && lockedAtSource ? t('serviceAccounts.checkLockedAtSource') : null,
            off && secretHandled ? t('serviceAccounts.checkSecretHandled') : null,
          ].filter(Boolean);
          change.mutate(
            {
              reason: done.length
                ? `${reason.trim()} (${t('serviceAccounts.checkDone')}: ${done.join('; ')})`
                : reason.trim(),
            },
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

        {off ? (
          <fieldset className="check-list">
            <legend className="muted">{t('serviceAccounts.checkLegend')}</legend>
            <label className="row confirm-check">
              <input
                type="checkbox"
                checked={lockedAtSource}
                onChange={(e) => setLockedAtSource(e.target.checked)}
              />
              <span>{t('serviceAccounts.checkLockedAtSource')}</span>
            </label>
            <label className="row confirm-check">
              <input
                type="checkbox"
                checked={secretHandled}
                onChange={(e) => setSecretHandled(e.target.checked)}
              />
              <span>{t('serviceAccounts.checkSecretHandled')}</span>
            </label>
          </fieldset>
        ) : null}

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
