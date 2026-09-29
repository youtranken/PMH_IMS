import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/format';

export interface SecretDueInfo {
  key: 'vault.dueLeft' | 'vault.dueToday' | 'vault.dueOver';
  count: number;
  tone: 'muted' | 'warn';
}

/**
 * Chữ + tông cho hạn đổi mật khẩu (Q-15) từ `dueInDays` server tính (âm = đã quá).
 *
 * Client KHÔNG tự tính từ ngày đổi và ngưỡng: ngưỡng là `dashboard.secret_stale_days` (AD-11)
 * và server mới biết nó đang đặt bao nhiêu. 0 là ngày server bật `valueStale` — đã phải đổi.
 */
export function secretDueInfo(dueInDays: number): SecretDueInfo {
  if (dueInDays > 0) return { key: 'vault.dueLeft', count: dueInDays, tone: 'muted' };
  if (dueInDays === 0) return { key: 'vault.dueToday', count: 0, tone: 'warn' };
  return { key: 'vault.dueOver', count: -dueInDays, tone: 'warn' };
}

/**
 * Ô "Đổi lần cuối": ngày đổi giá trị + đếm ngược tới hạn đổi. Dùng ở danh sách ngăn két và
 * danh sách tài khoản dịch vụ — một bản để hai nơi nói cùng một câu.
 */
export function SecretDue({
  changedAt,
  dueInDays,
}: {
  changedAt: string | undefined | null;
  dueInDays: number | undefined | null;
}) {
  const { t } = useTranslation();
  if (!changedAt || dueInDays === undefined || dueInDays === null) return <span>—</span>;
  const info = secretDueInfo(dueInDays);
  const text = t(info.key, { count: info.count });
  return (
    <span className="secret-due">
      <span>{formatDate(changedAt)}</span>{' '}
      {info.tone === 'warn' ? (
        <span className="badge warn">{text}</span>
      ) : (
        <span className="muted">{text}</span>
      )}
    </span>
  );
}
