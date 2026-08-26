import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import type { Me } from '@/lib/me';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';

interface CreateResult {
  user: { id: string; email: string };
  temporaryPassword: string;
}

/** Form tạo tài khoản (story 1.4). SA nhận mật khẩu tạm để trao tay người dùng. */
export function AccountForm({
  csrfToken,
  onClose,
  onCreated,
}: {
  csrfToken: string;
  onClose: () => void;
  onCreated: (temporaryPassword: string) => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Me['role']>('member');
  const [totpLoginRequired, setTotpLoginRequired] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const create = useApiMutation<
    { email: string; fullName: string; role: Me['role']; totpLoginRequired: boolean },
    CreateResult
  >('/api/v1/accounts', { csrfToken, refreshMe: false });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={520}
      title={t('accounts.create')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="account-form" className="btn primary" disabled={create.isPending}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="account-form"
        className="col"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate(
            { email: email.trim(), fullName: fullName.trim(), role, totpLoginRequired },
            {
              onSuccess: (result) => onCreated(result.temporaryPassword),
              onError: (err) => setError(errorMessage(err, 'Không tạo được tài khoản.')),
            },
          );
        }}
      >
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}

        <Field label={t('accounts.fullName')} required htmlFor="acc-name">
          <input
            id="acc-name"
            className="inp"
            required
            minLength={2}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </Field>

        <Field label={t('accounts.email')} required htmlFor="acc-email">
          <input
            id="acc-email"
            className="inp"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label={t('accounts.role')} required htmlFor="acc-role">
          <select
            id="acc-role"
            className="inp pick"
            value={role}
            onChange={(e) => setRole(e.target.value as Me['role'])}
          >
            <option value="member">{t('accounts.roleMember')}</option>
            <option value="admin">{t('accounts.roleAdmin')}</option>
            <option value="sa">{t('accounts.roleSa')}</option>
          </select>
        </Field>

        <label className="row" htmlFor="acc-totp">
          <input
            id="acc-totp"
            type="checkbox"
            checked={totpLoginRequired}
            onChange={(e) => setTotpLoginRequired(e.target.checked)}
          />
          <span>{t('accounts.totpRequired')}</span>
        </label>
      </form>
    </Dialog>
  );
}
