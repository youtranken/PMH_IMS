import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import type { Me } from '@/lib/me';
import { DatePicker } from '@/ui/date-picker';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { textRule, useFormErrors } from '@/ui/use-form-errors';
import { useStepUpRetry } from '@/ui/use-step-up-retry';
import { PhoneInput } from '@/ui/phone-input';
import { RoleChoice } from './role-choice';

interface CreateResult {
  user: { id: string; email: string; fullName: string; role: Me['role'] };
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
 * Form tài khoản (kèm SĐT/mã nhân viên).
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
  /* Kèm người vừa tạo để hộp mật khẩu tạm nói được nó thuộc về AI và dẫn sang bước tiếp theo. */
  onCreated: (
    temporaryPassword: string,
    created: { id: string; email: string; fullName: string; role: Me['role'] },
  ) => void;
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

  // Tạo tài khoản đòi step-up (`@RequiresStepUp`): hết ân hạn thì hỏi mã rồi tạo lại đúng bộ ô này.
  const stepUp = useStepUpRetry(csrfToken);

  const busy = create.isPending || update.isPending;

  const check = useFormErrors({
    fullName: textRule(t, fullName, 2),
    // Chỉ bắt lỗi gõ nhầm hiển nhiên (thiếu @, thiếu tên miền); API mới là nơi quyết email hợp lệ.
    email:
      !editing &&
      (!email.trim()
        ? t('formErrors.required')
        : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && t('formErrors.email')),
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!busy}
      guardUnsaved
      maxWidth={620}
      /* Tiêu đề nêu TÊN người; email dài ngắt giữa chừng trên điện thoại, và nó đã hiện ngay
         trong form. */
      title={editing ? t('accounts.editTitle', { name: account.fullName }) : t('accounts.create')}
      footer={
        <>
          <DialogCancel>
            {t('common.cancel')}
          </DialogCancel>
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
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          const contact = {
            fullName: fullName.trim(),
            phone: phone.trim(),
            employeeCode: employeeCode.trim(),
            birthDate,
          };
          if (editing) {
            update.mutate(contact, {
              onSuccess: onSaved,
              onError: (err) => setError(errorMessage(err, t('accounts.saveProfileFailed'))),
            });
            return;
          }
          const input = { ...contact, email: email.trim(), role, totpLoginRequired };
          stepUp.run(() => create.mutateAsync(input), t('accounts.stepUpCreate', { email: input.email })).then(
            (result) =>
              onCreated(result.temporaryPassword, {
                id: result.user.id,
                email: result.user.email,
                fullName: result.user.fullName,
                role: result.user.role,
              }),
            (err: unknown) => {
              if (err instanceof Error && err.message === 'STEPUP_CANCELLED') return;
              setError(errorMessage(err, t('accounts.createFailed')));
            },
          );
        }}
      >
        {check.summary}
        <Field
          label={t('accounts.fullName')}
          required
          htmlFor="acc-name"
          error={check.error('fullName')}
        >
          <input
            id="acc-name"
            className="inp"
            required
            minLength={2}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </Field>

        <Field
          label={t('accounts.email')}
          required
          htmlFor="acc-email"
          error={check.error('email')}
        >
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

        {/* Vai trò ngay sau Email: lựa chọn hệ trọng nhất của form (nó quyết ai xem được mọi
            két) không nằm cuối cùng sau ngày sinh. Đổi vai sau khi tạo: menu "Đổi vai trò…". */}
        {editing ? null : (
          <div className="span-2">
            <RoleChoice value={role} onChange={setRole} name="create-role" />
          </div>
        )}

        {/* Hai ô mới: gọi được người giữ máy lúc 2h sáng, và đối chiếu được sang bảng lương. */}
        <Field label={t('accounts.phone')} htmlFor="acc-phone">
          <PhoneInput
            id="acc-phone"
            maxLength={32}
            placeholder={t('accounts.phPhone')}
            value={phone}
            onChange={setPhone}
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
            openTo="1990-01-01"
            onChange={setBirthDate}
          />
        </Field>

        {editing ? null : (
          <>
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
      {stepUp.dialog}
    </Dialog>
  );
}
