import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PASSWORD_MIN_GROUPS,
  PASSWORD_MIN_LENGTH,
  checkPasswordRules,
} from '@/lib/password-rules';

/**
 * Luật mật khẩu dạng checklist tick dần khi gõ, thay cho một dòng gợi ý mờ: người dùng thấy
 * mình thiếu gì TRƯỚC khi bấm, không phải đoán sau câu lỗi.
 *
 * Bốn nhóm ký tự mỗi nhóm một dòng (Q-18): luật là 3 trong 4 (NFR-01), nên một nhóm còn ○ chưa
 * chắc là thiếu — dòng tiêu đề "Có ít nhất 3 trong 4" mới là dòng phán đạt/chưa.
 *
 * `repeat`: có thì thêm dòng "Hai mật khẩu khớp". Chưa khớp chỉ là ○, không phải chữ đỏ — người
 * đang gõ dở ô nhập lại không bị mắng.
 *
 * `aria-live="polite"`: trình đọc màn hình nghe được khi một dòng đổi sang đạt, không bị cắt
 * ngang lúc đang gõ.
 */
export function PasswordChecklist({
  password,
  repeat,
  id,
}: {
  password: string;
  repeat?: string;
  id?: string;
}) {
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
      <Rule ok={value.groupsOk}>{t('auth.ruleGroups', { min: PASSWORD_MIN_GROUPS })}</Rule>
      <div className="pw-rules-sub">
        {groups.map((group) => (
          <Rule key={group.key} ok={group.ok}>
            {t(group.key)}
          </Rule>
        ))}
      </div>
      {repeat !== undefined ? (
        <Rule ok={repeat.length > 0 && repeat === password}>{t('auth.passwordMatch')}</Rule>
      ) : null}
    </div>
  );
}

function Rule({ ok, children }: { ok: boolean; children: ReactNode }) {
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
