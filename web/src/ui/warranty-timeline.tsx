import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/format';
import { useExpiryThresholds } from './use-expiry-thresholds';
import { BREAKPOINTS } from './breakpoints';
import { useMediaQuery } from './use-media-query';
import { warrantyProgress } from './warranty-progress';

/**
 * Thanh thời hạn — mốc đầu → HÔM NAY → mốc cuối, màu chạy theo phần đường đã đi.
 *
 * Thay cho một cái nhãn chữ trơ trọi ("Còn 157 ngày") vốn trả lời đúng một câu và giấu ba câu
 * còn lại. Dùng chung ở BỐN chỗ cùng hỏi một điều (AD-15): bảo hành thiết bị, hạn
 * license/SSL/tên miền, hợp đồng đường truyền, và cột hạn ở màn Sắp hết hạn.
 *
 * Màu và chữ đọc từ `expiryLevel`/`expiryLabel` dùng chung, nên thanh này và `ExpiryBadge`
 * không bao giờ nói khác nhau — đổi ngưỡng một chỗ là đổi cả hai.
 */
export function WarrantyTimeline({
  start,
  end,
  now,
  compact = false,
  startLabel,
  endLabel,
  notCounted = false,
}: {
  /**
   * Hồ sơ đã ở trạng thái cuối (thanh lý): hạn thôi có nghĩa. Thanh xám trơn thay cho sọc đỏ
   * "Quá hạn 800 ngày" — cùng luật với `ExpiryBadge notCounted`, để trang chi tiết và danh sách
   * không nói ngược nhau về cùng một máy.
   */
  notCounted?: boolean;
  /** Mốc bắt đầu; thiếu thì vẽ thanh "chỉ có đích" chứ không bịa ra một điểm đầu. */
  start?: string | null;
  end?: string | null;
  now?: Date;
  /** Bản gọn cho dải chỉ số ở đầu trang: chỉ còn thanh, không có nhãn hai đầu. */
  compact?: boolean;
  startLabel?: string;
  endLabel?: string;
}) {
  const { t } = useTranslation();
  /* Màn hẹp (khớp `@media (max-width: 480px)`): ô chỉ còn nửa thẻ, nhãn dài "Bảo hành từ" gãy
     ba dòng đè lên ngày. Rút còn Từ/Đến — tên đầy đủ đã là nhãn của dòng chứa thanh này. */
  const tight = useMediaQuery(BREAKPOINTS.tight);
  const fromLabel = tight ? t('expiry.from') : (startLabel ?? t('expiry.from'));
  const toLabel = tight ? t('expiry.to') : (endLabel ?? t('expiry.to'));
  // Cùng nguồn ngưỡng với `ExpiryBadge` — nếu không thì thanh và huy hiệu lại nói khác nhau,
  // đúng thứ chú thích đầu file này hứa sẽ không bao giờ xảy ra (AD-11).
  const progress = warrantyProgress({ start, end, now, thresholds: useExpiryThresholds() });
  // Không có hạn thì không có quãng đường nào để vẽ — thanh rỗng chỉ làm người đọc tưởng
  // dữ liệu bị mất.
  // `end` luôn có mặt khi `progress` khác null (xem `warrantyProgress`), nhưng
  // `strictNullChecks` đang TẮT nên TS không tự suy ra được — kiểm tường minh thay vì
  // khẳng định bằng `!`. Ba dấu `!` cũ ở đây là lời khẳng định không ai kiểm.
  if (!progress || !end) return null;

  if (notCounted) {
    return (
      <div className={`wt${compact ? ' wt-mini' : ''}`}>
        <div className="wt-track" aria-hidden="true">
          <div className="wt-fill none" style={{ right: 0 }} />
        </div>
        <div className="wt-legend">
          <span className="left">
            {toLabel} {formatDate(end)}
          </span>
          <span className="right muted">{t('expiry.notCountedRetired')}</span>
        </div>
      </div>
    );
  }

  const tone = TONE[progress.level];
  const percent = progress.percent ?? 100;

  return (
    <div className={`wt${compact ? ' wt-mini' : ''}`}>
      {compact || !progress.hasStart ? null : (
        <div className="wt-ends">
          <span>
            {fromLabel} <b>{formatDate(start)}</b>
          </span>
          <span>
            {toLabel} <b>{formatDate(end)}</b>
          </span>
        </div>
      )}

      <div
        className="wt-track"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${endLabel ?? t('expiry.to')} ${formatDate(end)} — ${progress.label}`}
      >
        <div className={`wt-fill ${tone}`} style={{ right: `${100 - percent}%` }} />
        {/* Mốc HÔM NAY: cái tam giác là thứ trả lời "mình đang đứng ở đâu trên quãng đường",
            câu mà ba ô ngày rời nhau không bao giờ trả lời được. */}
        <span className="wt-now" style={{ left: `${percent}%` }} />
      </div>

      {compact ? null : (
        <div className="wt-legend">
          <span className="left">
            {progress.hasStart
              ? t('expiry.walked', { percent: progress.percent })
              : t('expiry.noStart')}
          </span>
          <span className={`right ${tone}`}>{progress.label}</span>
        </div>
      )}
    </div>
  );
}

/** Mức độ → lớp màu. `none` không tới được đây (không có hạn thì đã trả null ở trên). */
const TONE: Record<string, string> = {
  ok: 'ok',
  warning: 'warn',
  critical: 'crit',
  expired: 'over',
  none: 'ok',
};
