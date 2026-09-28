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
      ? t('software.perpetual')
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
  if (!supportsSeats(item.kind) || item.seatTotal === null) {
    return <span className="mono">{seatLabel(item)}</span>;
  }
  const flag = seatFlag(item.seatUsed, item.seatTotal);
  return (
    <>
      <UsageBar
        percent={item.seatTotal === 0 ? 100 : (item.seatUsed / item.seatTotal) * 100}
        label={seatLabel(item)}
        showPercent={false}
        ariaLabel={t('software.seats')}
      />
      {flag ? (
        <span className="cell-sub is-danger">
          {flag.over > 0 ? t('software.seatsOver', { count: flag.over }) : t('software.seatsFull')}
        </span>
      ) : null}
    </>
  );
}
