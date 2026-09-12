import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import type { Me } from '@/lib/me';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';

interface CreateResult {
  user: { id: string; email: string };
  temporaryPassword: string;
}

export interface AccountProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  employeeCode: string | null;
  birthDate: string | null;
}

/**
 * Form tài khoản (story 1.4 + SĐT/mã nhân viên 0031).
 *
 * Một hộp cho cả TẠO lẫn SỬA vì các ô là một bộ; hai hộp thì lần sau thêm một ô sẽ chỉ nhớ
 * thêm vào một bên. Khác nhau đúng ba chỗ: tạo thì có Email + Vai trò + "bắt 2 lớp" và trả
 * về mật khẩu tạm; sửa thì không.
 *
 * Vì sao SỬA không cho đổi email: email là DANH TÍNH đăng nhập và là thứ mọi dòng nhật ký
 * đang trỏ tới. Đổi nó là đổi người — ai cần đổi thì tạo tài khoản mới rồi vô hiệu hoá cái
 * cũ, để vết cũ vẫn chỉ đúng người đã làm.
 */
export function AccountForm({
  account,
  csrfToken,
  onClose,
  onCreated,
  onSaved,
}: {
  /** null = tạo mới. */
  account: AccountProfile | null;
  csrfToken: string;
  onClose: () => void;
  /* Kèm email để hộp mật khẩu tạm nói được nó thuộc về AI — xem `accounts-screen.tsx`. */
  onCreated: (temporaryPassword: string, email: string) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const editing = account !== null;
  const [email, setEmail] = useState(account?.email ?? '');
  const [fullName, setFullName] = useState(account?.fullName ?? '');
  const [phone, setPhone] = useState(account?.phone ?? '');
  const [employeeCode, setEmployeeCode] = useState(account?.employeeCode ?? '');
  const [birthDate, setBirthDate] = useState(account?.birthDate ?? '');
  const [role, setRole] = useState<Me['role']>('member');
  const [totpLoginRequired, setTotpLoginRequired] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const create = useApiMutation<Record<string, unknown>, CreateResult>('/api/v1/accounts', {
    csrfToken,
    refreshMe: false,
  });

  const update = useApiMutation<Record<string, unknown>, unknown>(
    `/api/v1/accounts/${account?.id ?? ''}/profile`,
    { method: 'PATCH', csrfToken, refreshMe: false },
  );

  const busy = create.isPending || update.isPending;

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!busy}
      guardUnsaved
      maxWidth={620}
      title={editing ? `${t('accounts.edit')} — ${account.email}` : t('accounts.create')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="account-form" className="btn primary" disabled={busy}>
            {busy ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="account-form"
        className="form-grid"
        data-columns={2}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const contact = {
            fullName: fullName.trim(),
            phone: phone.trim(),
            employeeCode: employeeCode.trim(),
            birthDate,
          };
          if (editing) {
            update.mutate(contact, {
              onSuccess: onSaved,
              onError: (err) => setError(errorMessage(err, 'Không lưu được hồ sơ.')),
            });
            return;
          }
          create.mutate(
            { ...contact, email: email.trim(), role, totpLoginRequired },
            {
              onSuccess: (result) => onCreated(result.temporaryPassword, email.trim()),
              onError: (err) => setError(errorMessage(err, 'Không tạo được tài khoản.')),
            },
          );
        }}
      >
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
          {editing ? (
            // Hiện thẳng chữ chứ không phải ô nhập bị khoá: ô khoá thì người dùng còn ngồi
            // thử bấm và tự hỏi vì sao không gõ được.
            <p className="static-value mono" data-testid="account-email">{account.email}</p>
          ) : (
            <input
              id="acc-email"
              className="inp"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>

        {/* Hai ô mới: gọi được người giữ máy lúc 2h sáng, và đối chiếu được sang bảng lương. */}
        <Field label={t('accounts.phone')} htmlFor="acc-phone">
          <input
            id="acc-phone"
            className="inp mono"
            type="tel"
            inputMode="tel"
            maxLength={32}
            placeholder={t('accounts.phPhone')}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>

        <Field
          label={t('accounts.employeeCode')}
          hint={t('accounts.employeeCodeHint')}
          htmlFor="acc-emp"
        >
          <input
            id="acc-emp"
            className="inp mono"
            maxLength={32}
            placeholder={t('accounts.phEmployeeCode')}
            value={employeeCode}
            onChange={(e) => setEmployeeCode(e.target.value)}
          />
        </Field>

        <Field label={t('accounts.birthDate')}>
          <DatePicker
            value={birthDate}
            ariaLabel={t('accounts.birthDate')}
            onChange={setBirthDate}
          />
        </Field>

        {editing ? null : (
          <>
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

            <Field label={t('accounts.totpRequired')}>
              <label className="row" htmlFor="acc-totp" style={{ gap: 'var(--space-3)' }}>
                <input
                  id="acc-totp"
                  type="checkbox"
                  checked={totpLoginRequired}
                  onChange={(e) => setTotpLoginRequired(e.target.checked)}
                />
                <span className="muted">{t('accounts.totpRequiredHint')}</span>
              </label>
            </Field>
          </>
        )}

        {error ? (
          <p className="alert error span-2" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
