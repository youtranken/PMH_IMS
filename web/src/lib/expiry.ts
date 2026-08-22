/**
 * AD-15: MỘT hàm duy nhất quyết định "sắp hết hạn" cho toàn hệ thống.
 * Bảo hành thiết bị, license, SSL, domain, hợp đồng ISP, phiếu… đều gọi hàm này —
 * không màn nào tự so ngày rồi tự chọn màu.
 *
 * Ngưỡng mặc định khớp luật digest (system_config, Epic 3): 30 ngày là "sắp", 7 ngày là "gấp".
 */
export type ExpiryLevel = 'expired' | 'critical' | 'warning' | 'ok' | 'none';

export interface ExpiryThresholds {
  /** Còn ≤ số ngày này → 'critical'. */
  criticalDays: number;
  /** Còn ≤ số ngày này → 'warning'. */
  warningDays: number;
}

export const DEFAULT_EXPIRY_THRESHOLDS: ExpiryThresholds = {
  criticalDays: 7,
  warningDays: 30,
};

const MS_PER_DAY = 86_400_000;

/**
 * Số ngày còn lại tính theo NGÀY LỊCH ở múi giờ người dùng, không theo 24 giờ trôi qua:
 * hết hạn "hôm nay" luôn ra 0 dù bây giờ là 8 giờ sáng hay 11 giờ đêm.
 */
export function daysUntil(end: string | Date, now: Date = new Date()): number {
  const endDate = typeof end === 'string' ? parseDateOnly(end) : startOfDay(end);
  return Math.round((endDate.getTime() - startOfDay(now).getTime()) / MS_PER_DAY);
}

export function expiryLevel(
  end: string | Date | null | undefined,
  now: Date = new Date(),
  thresholds: ExpiryThresholds = DEFAULT_EXPIRY_THRESHOLDS,
): ExpiryLevel {
  if (!end) return 'none';
  const days = daysUntil(end, now);
  if (days < 0) return 'expired';
  if (days <= thresholds.criticalDays) return 'critical';
  if (days <= thresholds.warningDays) return 'warning';
  return 'ok';
}

/** Nhãn tiếng Việt ngắn để hiện trong badge. */
export function expiryLabel(
  end: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!end) return 'Không có hạn';
  const days = daysUntil(end, now);
  if (days < 0) return `Quá hạn ${Math.abs(days)} ngày`;
  if (days === 0) return 'Hết hạn hôm nay';
  if (days === 1) return 'Còn 1 ngày';
  return `Còn ${days} ngày`;
}

function parseDateOnly(value: string): Date {
  // 'YYYY-MM-DD' (kiểu `date` thuần của Postgres) — dựng theo giờ địa phương,
  // KHÔNG qua UTC, nếu không ngày sẽ lệch 1 ở múi giờ +07.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  return startOfDay(new Date(value));
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
