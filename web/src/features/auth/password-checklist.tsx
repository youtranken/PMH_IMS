import { useTranslation } from 'react-i18next';
import { PASSWORD_MIN_LENGTH, checkPasswordRules } from '@/lib/password-rules';

/**
 * Luật mật khẩu dạng checklist tick dần khi gõ, thay cho một dòng gợi ý mờ: người dùng thấy
 * mình thiếu gì TRƯỚC khi bấm, không phải đoán sau câu lỗi.
 *
 * `aria-live="polite"`: trình đọc màn hình nghe được khi một dòng đổi sang đạt, không bị cắt
 * ngang lúc đang gõ.
 */
export function PasswordChecklist({ password, id }: { password: string; id?: string }) {
  const { t } = useTranslation();
  const { value } = checkPasswordRules(password);
  const groups: { ok: boolean; key: string }[] = [
    { ok: value.groups.lower, key: 'auth.groupLower' },
    { ok: value.groups.upper, key: 'auth.groupUpper' },
    { ok: value.groups.digit, key: 'auth.groupDigit' },
    { ok: value.groups.special, key: 'auth.groupSpecial' },
  ];
  return (
    <div className="pw-rules" id={id} aria-live="polite">
      <Rule ok={value.lengthOk}>
        {t('auth.ruleLength', { min: PASSWORD_MIN_LENGTH, count: value.length })}
      </Rule>
      <Rule ok={value.groupsOk}>
        {t('auth.ruleGroups', { count: value.groupCount })}{' '}
        {groups.map((group, i) => (
          <span key={group.key} className={group.ok ? 'pw-group on' : 'pw-group'}>
            {i > 0 ? ' · ' : ''}
            {t(group.key)}
          </span>
        ))}
      </Rule>
    </div>
  );
}

function Rule({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <p className={ok ? 'pw-rule ok' : 'pw-rule'}>
      <span className="pw-rule-icon" aria-hidden="true">
        {ok ? '✓' : '○'}
      </span>
      <span>
        {children}
        <span className="sr-only"> — {t(ok ? 'auth.ruleMet' : 'auth.ruleNotMet')}</span>
      </span>
    </p>
  );
}
