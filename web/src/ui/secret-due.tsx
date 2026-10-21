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
/**
 * Chip nhỏ cạnh mã hồ sơ ở danh sách (K-03, TB-18): "Két" — tới / quá hạn đổi thì tô cảnh báo và
 * nói số ngày. Đủ câu "Két đổi lần cuối dd/mm/yyyy · còn n ngày" ở `title`. Không phải dòng phụ:
 * dòng phụ làm dòng có két cao hơn dòng khác. Hồ sơ không có két thì không vẽ gì.
 */
export function SecretDueSub({ entry }: { entry: { valueChangedAt: string; dueInDays: number } | undefined }) {
  const { t } = useTranslation();
  if (!entry) return null;
  const info = secretDueInfo(entry.dueInDays);
  const title = `${t('vault.dueSubLabel')} ${formatDate(entry.valueChangedAt)} · ${t(info.key, { count: info.count })}`;
  return (
    <>
      {' '}
      <span className={`badge plain ${info.tone === 'warn' ? 'warn' : 'muted'}`} title={title}>
        {info.key === 'vault.dueOver'
          ? t('vault.dueChipOver', { count: info.count })
          : info.key === 'vault.dueToday'
            ? t('vault.dueChipToday')
            : t('vault.dueChip')}
      </span>
    </>
  );
}

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
