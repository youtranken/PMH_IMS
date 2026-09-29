import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/lib/api';
import type { Me } from '@/lib/me';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { textRule, useFormErrors } from '@/ui/use-form-errors';
import { AccountFootprint } from './account-footprint';
import { RoleChoice } from './role-choice';

/** Người đang được thao tác — đủ để câu chữ nêu đích danh và dẫn sang màn khác. */
export interface AccountRef {
  id: string;
  fullName: string;
  email: string;
  role: Me['role'];
}

/** Lý do gõ nhanh cho khóa / vô hiệu hóa — ba cảnh gặp nhiều nhất. */
const QUICK_REASONS = ['accounts.reasonCompromised', 'accounts.reasonLeft', 'accounts.reasonLongLeave'];

/**
 * Khóa / Vô hiệu hóa kèm LÝ DO — hành động an ninh cần vết: nhật ký "account.locked" trơ trọi
 * không trả lời được "vì sao". Lý do đi vào `detail` của dòng nhật ký.
 *
 * Vô hiệu hóa (người nghỉ việc) còn đếm những thứ người đó đang giữ: quyền két, yêu cầu mở két
 * đang chờ, thiết bị — vô hiệu tài khoản KHÔNG tự gỡ chúng, và đó là chỗ hay bị sót khi nghỉ việc.
 *
 * Dialog riêng thay vì `useConfirm`: hộp xác nhận cố ý chỉ nhận một ô tick, còn đây là một ô
 * nhập bắt buộc (xem chú thích ở `ui/confirm-dialog.tsx`).
 */
export function AccountStatusDialog({
  account,
  to,
  title,
  message,
  confirmLabel,
  danger,
  onClose,
  onSubmit,
}: {
  account: AccountRef;
  to: 'locked' | 'disabled';
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  onClose: () => void;
  /** Gọi API (kèm step-up) — ném lỗi thì hộp giữ nguyên và hiện lỗi. */
  onSubmit: (reason: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = useFormErrors({ reason: textRule(t, reason, 3) });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!busy}
      maxWidth={520}
      title={title}
      initialFocus="first-field"
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="account-status-form"
            className={danger ? 'btn danger' : 'btn primary'}
            disabled={busy}
          >
            {busy ? t('common.loading') : confirmLabel}
          </button>
        </>
      }
    >
      <form
        id="account-status-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          if (!check.check()) return;
          setBusy(true);
          onSubmit(reason.trim()).then(
            () => setBusy(false),
            (err: unknown) => {
              setBusy(false);
              if (err instanceof Error && err.message === 'STEPUP_CANCELLED') return;
              setError(errorMessage(err));
            },
          );
        }}
      >
        <p>{message}</p>
        <Field label={t('accounts.reason')} required htmlFor="account-status-reason" error={check.error('reason')}>
          <textarea
            id="account-status-reason"
            className="inp"
            rows={2}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div className="chip-row" role="group" aria-label={t('accounts.reasonQuick')}>
          {QUICK_REASONS.map((key) => (
            <button key={key} type="button" className="btn sm" onClick={() => setReason(t(key))}>
              {t(key)}
            </button>
          ))}
        </div>
        {to === 'disabled' ? (
          <section aria-labelledby="offboard-title" className="alert info">
            <h3 id="offboard-title" className="lbl-t">
              {t('accounts.offboardTitle')}
            </h3>
            <AccountFootprint account={account} />
          </section>
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

/**
 * Đổi vai trò sau khi tạo — thăng/hạ mà không phải tạo tài khoản thứ hai (lịch sử cắt đôi).
 * Hạ một Thành viên đang có quyền két xuống/lên: nhắc rằng quyền két theo vai sẽ đổi.
 */
export function RoleDialog({
  account,
  onClose,
  onSubmit,
}: {
  account: AccountRef;
  onClose: () => void;
  onSubmit: (role: Me['role']) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [role, setRole] = useState<Me['role']>(account.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = role === account.role;

  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!busy}
      maxWidth={520}
      title={t('accounts.changeRoleOf', { name: account.fullName })}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || unchanged}
            onClick={() => {
              setError(null);
              setBusy(true);
              onSubmit(role).then(
                () => setBusy(false),
                (err: unknown) => {
                  setBusy(false);
                  if (err instanceof Error && err.message === 'STEPUP_CANCELLED') return;
                  setError(errorMessage(err));
                },
              );
            }}
          >
            {busy ? t('common.loading') : t('accounts.changeRoleSubmit')}
          </button>
        </>
      }
    >
      <p className="muted">{account.email}</p>
      <RoleChoice value={role} onChange={setRole} name="change-role" />
      {!unchanged && account.role === 'member' ? (
        <p className="muted">{t('accounts.changeRoleFromMember')}</p>
      ) : null}
      {!unchanged && role === 'member' ? (
        <p className="alert warn" role="note">
          {t('accounts.changeRoleToMember')}
        </p>
      ) : null}
      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
