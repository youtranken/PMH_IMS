import { expiryLabel, expiryLevel, type ExpiryLevel } from '@/lib/expiry';
import { useExpiryThresholds } from './use-expiry-thresholds';

const TONE: Record<ExpiryLevel, string> = {
  expired: 'danger',
  critical: 'danger',
  warning: 'warn',
  ok: 'ok',
  none: 'muted',
};

/**
 * Nhãn trạng thái hạn — AD-15: mọi màn (thiết bị, phần mềm, ISP, expiry, dashboard)
 * dùng chung component này, nên "sắp hết hạn" ở đâu cũng cùng một luật và cùng một màu.
 */
export function ExpiryBadge({
  end,
  now,
  showDate = false,
}: {
  end: string | Date | null | undefined;
  now?: Date;
  showDate?: boolean;
}) {
  // Ngưỡng đọc TỪ SERVER (AD-11), không phải bản sao trong web — xem `use-expiry-thresholds`.
  const thresholds = useExpiryThresholds();
  const level = expiryLevel(end, now, thresholds);
  const label = expiryLabel(end, now);
  return (
    <span className={`badge ${TONE[level]}`} title={showDate && end ? String(end) : undefined}>
      {label}
    </span>
  );
}
