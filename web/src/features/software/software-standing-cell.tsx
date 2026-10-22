import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/format';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { PerpetualBadge } from '@/ui/perpetual-badge';
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
    const badge = <ExpiryBadge end={item.endDate} notCounted={item.status === 'retired'} />;
    if (compact || !item.endDate) return badge;
    // Ngày hết hạn ngay dưới "Còn n ngày" (P-01): không phải mở hồ sơ mới biết ngày nào.
    return (
      <>
        {badge}
        <span className="cell-sub">{t('software.endsOn', { date: formatDate(item.endDate) })}</span>
      </>
    );
  }

  const badge = (
    <span className={`badge ${STATUS_TONE[item.status]}`}>{t(STATUS_KEY[item.status])}</span>
  );
  if (compact) return badge;

  const sub =
    standing.kind === 'perpetual'
      ? <PerpetualBadge plain />
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
 * Ô "Hết hạn" của DANH SÁCH phần mềm (PW-A07 / TB-13). Cột sắp theo ngày nên ngày là dòng chính
 * — trộn "Còn 349 ngày" với "Hết hạn" trên dòng chính thì mắt không quét theo hạn được. Dòng phụ:
 * huy hiệu đếm ngày khi đang dùng, huy hiệu trạng thái khi khác Đang dùng. Trang chi tiết và thẻ
 * điện thoại vẫn dùng `SoftwareStanding`.
 */
export function SoftwareEndCell({ item }: { item: SoftwareRow }) {
  const { t } = useTranslation();
  const standing = standingOf(item);
  if (standing.kind === 'perpetual') return <PerpetualBadge plain />;
  if (standing.kind === 'noEnd') return <span className="muted">{t('expiry.labelNone')}</span>;
  const main = item.endDate ? formatDate(item.endDate) : '—';
  if (standing.kind === 'countdown') {
    return (
      <>
        {main}
        <span className="cell-sub">
          <ExpiryBadge end={item.endDate} />
        </span>
      </>
    );
  }
  // Hết hạn: ngày ở dòng chính đã nói quá bao lâu; chỉ thêm mốc tự thanh lý nếu đang bật.
  const retire =
    standing.kind !== 'expired' || standing.retireInDays === null
      ? null
      : standing.retireInDays === 0
        ? t('software.autoRetireNext')
        : t('software.autoRetireIn', { count: standing.retireInDays });
  return (
    <>
      {main}
      <span className="cell-sub">
        <span className={`badge ${STATUS_TONE[item.status]}`}>{t(STATUS_KEY[item.status])}</span>
        {retire ? ` ${retire}` : null}
      </span>
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
