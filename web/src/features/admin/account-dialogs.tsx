import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/lib/api';
import type { Me } from '@/lib/me';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { useFeatureGroups } from '@/ui/use-feature-groups';
import { reasonRule, useFormErrors, useSubmitError } from '@/ui/use-form-errors';
import { isStepUpCancelled } from '@/ui/use-step-up-retry';
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
  const [error, setError] = useSubmitError([reason]);
  const check = useFormErrors({ reason: reasonRule(t, reason) });

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
            {busy ? t('common.working') : confirmLabel}
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
              if (isStepUpCancelled(err)) return;
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
  const [error, setError] = useSubmitError([role]);
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
                  if (isStepUpCancelled(err)) return;
                  setError(errorMessage(err));
                },
              );
            }}
          >
            {busy ? t('common.working') : t('accounts.changeRoleSubmit')}
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

/**
 * Ô chọn nhóm quyền của một Thành viên (Q-31). Giá trị `''` = "Đủ quyền" (chưa gán nhóm). Dùng ở
 * hộp Thêm người dùng và hộp Đổi nhóm quyền.
 */
export function FeatureGroupSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (groupId: string) => void;
}) {
  const { t } = useTranslation();
  const groups = useFeatureGroups();
  return (
    <Field label={t('featureGroups.field')} htmlFor={id}>
      <Select
        id={id}
        value={value}
        onChange={onChange}
        failed={groups.isError}
        options={[
          { value: '', label: t('featureGroups.fullAccess') },
          ...(groups.data ?? []).map((group) => ({ value: group.id, label: group.name })),
        ]}
      />
    </Field>
  );
}

/** Đổi nhóm quyền của một Thành viên — không đòi mã 6 số (Q-31). */
export function FeatureGroupDialog({
  account,
  onClose,
  onSubmit,
}: {
  account: AccountRef & { featureGroupId?: string | null };
  onClose: () => void;
  onSubmit: (groupId: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [groupId, setGroupId] = useState(account.featureGroupId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useSubmitError([groupId]);
  const unchanged = groupId === (account.featureGroupId ?? '');
  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!busy}
      maxWidth={440}
      title={t('featureGroups.changeTitle', { name: account.fullName })}
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
              onSubmit(groupId || null).then(
                () => setBusy(false),
                (err: unknown) => {
                  setBusy(false);
                  setError(errorMessage(err));
                },
              );
            }}
          >
            {busy ? t('common.working') : t('featureGroups.save')}
          </button>
        </>
      }
    >
      <FeatureGroupSelect id="feature-group-of" value={groupId} onChange={setGroupId} />
      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
