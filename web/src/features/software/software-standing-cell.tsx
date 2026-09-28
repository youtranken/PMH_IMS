import { useTranslation } from 'react-i18next';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { UsageBar } from '@/ui/usage-bar';
import { seatFlag, standingOf } from './software-standing';
import { STATUS_KEY, STATUS_TONE, seatLabel, supportsSeats, type SoftwareRow } from './software-types';

/**
 * Ô "Tình trạng" của hồ sơ phần mềm — danh sách, thẻ điện thoại và thẻ định danh ở trang chi
 * tiết dùng chung, để ba chỗ nói cùng một câu. Luật chọn nằm ở `standingOf`.
 *
 * `compact`: chỉ badge, bỏ dòng phụ — cho góc phải của thẻ điện thoại.
 */
export function SoftwareStanding({ item, compact = false }: { item: SoftwareRow; compact?: boolean }) {
  const { t } = useTranslation();
  const standing = standingOf(item);

  // Đang dùng có hạn: badge đếm ngày đã là nhãn màu "sắp hết hạn" của Q-03, đủ một mình.
  if (standing.kind === 'countdown') {
    // `countdown` chỉ đến từ hồ sơ chưa Thanh lý; khai `notCounted` để luật canh ở
    // `expiry-badge.test.tsx` không phải đoán nhánh.
    return <ExpiryBadge end={item.endDate} notCounted={item.status === 'retired'} />;
  }

  const badge = (
    <span className={`badge ${STATUS_TONE[item.status]}`}>{t(STATUS_KEY[item.status])}</span>
  );
  if (compact) return badge;

  const sub =
    standing.kind === 'perpetual'
      ? `∞ ${t('software.perpetual')}`
      : standing.kind === 'noEnd'
        ? t('expiry.labelNone')
        : standing.kind === 'expired'
          ? [
              standing.overdueDays !== null
                ? t('software.overdueDays', { count: standing.overdueDays })
                : null,
              standing.retireInDays === null
                ? null
                : standing.retireInDays === 0
                  ? t('software.autoRetireNext')
                  : t('software.autoRetireIn', { count: standing.retireInDays }),
            ]
              .filter(Boolean)
              .join(' · ')
          : null;

  return (
    <>
      {badge}
      {sub ? <span className="cell-sub">{sub}</span> : null}
    </>
  );
}

/**
 * Ô "Ghế": thanh đo nói tỉ lệ, chữ chỉ in phân số. Dùng đủ hoặc vượt thì thêm dòng đỏ —
 * đó là lúc phải mua thêm hoặc gỡ bớt.
 */
export function SeatUsage({ item }: { item: SoftwareRow }) {
  const { t } = useTranslation();
  /* Không có ghế (SSL, tên miền, không giới hạn) hoặc đã Thanh lý (ghế đã gỡ hết): một dấu
     gạch chữ thường như cột Nhà cung cấp — không mono, không vẽ thanh 0% trống rỗng. */
  if (!supportsSeats(item.kind) || item.seatTotal === null || item.status === 'retired') {
    return <span className="muted">—</span>;
  }
  const flag = seatFlag(item.seatUsed, item.seatTotal);
  // Hết hạn mà vẫn cài trên máy là rủi ro, không phải "còn ghế": thanh xám, kèm câu nói rõ.
  const expired = item.status === 'expired_ok' && item.seatUsed > 0;
  return (
    <>
      <span
        className={expired ? 'usage-expired' : undefined}
        title={expired ? t('software.seatsExpired') : undefined}
      >
        <UsageBar
          percent={item.seatTotal === 0 ? 100 : (item.seatUsed / item.seatTotal) * 100}
          label={seatLabel(item)}
          showPercent={false}
          ariaLabel={t('software.seats')}
        />
      </span>
      {flag ? (
        <span className="cell-sub is-danger">
          {flag.over > 0 ? t('software.seatsOver', { count: flag.over }) : t('software.seatsFull')}
        </span>
      ) : expired ? (
        <span className="cell-sub is-danger">{t('software.seatsExpired')}</span>
      ) : null}
    </>
  );
}
