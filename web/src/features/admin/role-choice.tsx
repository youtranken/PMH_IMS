import { useTranslation } from 'react-i18next';
import type { Me } from '@/lib/me';

type Role = Me['role'];

const ROLES: { role: Role; label: string; hint: string }[] = [
  { role: 'member', label: 'accounts.roleMember', hint: 'accounts.roleMemberHint' },
  { role: 'admin', label: 'accounts.roleAdmin', hint: 'accounts.roleAdminHint' },
  { role: 'sa', label: 'accounts.roleSa', hint: 'accounts.roleSaHint' },
];

/**
 * Chọn vai trò bằng ba lựa chọn CÓ MÔ TẢ — dùng ở hộp Thêm người dùng và hộp Đổi vai trò.
 *
 * Vai trò là lựa chọn hệ trọng nhất của cả form (nó quyết ai xem được mọi két), nên không
 * được là một ô `<select>` ba chữ không giải thích: người chọn phải đọc được mỗi vai làm được
 * gì ngay tại chỗ. Chọn Super Admin thì kèm một câu cảnh báo.
 */
export function RoleChoice({
  value,
  onChange,
  name,
}: {
  value: Role;
  onChange: (role: Role) => void;
  /** Tên nhóm radio — hai hộp mở cùng lúc thì không được trùng tên. */
  name: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="ff-contents">
      <legend className="lbl-t">{t('accounts.role')}</legend>
      <ul className="pick-list role-choice">
        {ROLES.map((item) => (
          <li key={item.role}>
            <label className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <input
                type="radio"
                name={name}
                value={item.role}
                checked={value === item.role}
                onChange={() => onChange(item.role)}
              />
              <span>
                <b>{t(item.label)}</b>
                <span className="cell-sub">{t(item.hint)}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {value === 'sa' ? (
        <p className="alert warn" role="note">
          {t('accounts.roleSaWarn')}
        </p>
      ) : null}
    </fieldset>
  );
}
