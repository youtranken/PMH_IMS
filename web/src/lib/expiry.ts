/**
 * AD-15: MỘT hàm duy nhất quyết định "sắp hết hạn" cho toàn hệ thống.
 * Bảo hành thiết bị, license, SSL, domain, hợp đồng ISP, phiếu… đều gọi hàm này —
 * không màn nào tự so ngày rồi tự chọn màu.
 *
 * Ngưỡng mặc định khớp luật digest (system_config): 30 ngày là "sắp", 7 ngày là "gấp".
 */
import i18n from '@/lib/i18n';

export type ExpiryLevel = 'expired' | 'critical' | 'warning' | 'ok' | 'none';

export interface ExpiryThresholds {
  /** Còn ≤ số ngày này → 'critical'. */
  criticalDays: number;
  /** Còn ≤ số ngày này → 'warning'. */
  warningDays: number;
}

/**
 * Giá trị dùng TRONG LÚC CHỜ, không phải bản sao của luật.
 *
 * Luật thật nằm ở `system_config` (`expiry.critical_days` / `expiry.warning_days`, migration
 * 0041) và web đọc nó qua `useExpiryThresholds()`. Hai con số dưới đây KHÔNG phải một bản
 * sao độc lập của luật — một bản sao chỉ "khớp nhau" bằng lời hứa chứ không bằng cơ chế.
 *
 * Giữ lại vì hai lý do, cả hai đều KHÔNG phải "để tiện": (1) vẽ huy hiệu xám cho cả màn trong
 * 200ms đầu rồi đổi màu tệ hơn nhiều so với vẽ đúng ngay; (2) hàm thuần dưới đây có bảng test
 * riêng và không được phụ thuộc mạng. Hai số này PHẢI khớp giá trị seed của 0041.
 */
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

/**
 * THANG PHÂN LOẠI, nhận thẳng SỐ NGÀY còn lại.
 *
 * Tách khỏi `expiryLevel` vì có nơi đã có sẵn `daysLeft` do server tính — màn Sắp hết hạn
 * nhận `daysLeft` trong từng dòng. Nơi ấy gọi hàm này, không viết lại ba nhánh ở tầng màn
 * hình: `docs/SHARED-REGISTRY.md` gọi đây là "luật 'sắp hết hạn' DUY NHẤT của hệ thống"; hai
 * bản thì sẽ có ngày chúng trả lời khác nhau.
 *
 * Không trả `'none'`: ở đây đã có một con số, tức đã có hạn. Vế "không có hạn" là việc của
 * `expiryLevel`, nơi `end` có thể `null`.
 */
function levelFromDays(
  days: number,
  thresholds: ExpiryThresholds = DEFAULT_EXPIRY_THRESHOLDS,
): Exclude<ExpiryLevel, 'none'> {
  if (days < 0) return 'expired';
  if (days <= thresholds.criticalDays) return 'critical';
  if (days <= thresholds.warningDays) return 'warning';
  return 'ok';
}

export function expiryLevel(
  end: string | Date | null | undefined,
  now: Date = new Date(),
  thresholds: ExpiryThresholds = DEFAULT_EXPIRY_THRESHOLDS,
): ExpiryLevel {
  if (!end) return 'none';
  return levelFromDays(daysUntil(end, now), thresholds);
}

/** Nhãn ngắn để hiện trong badge — câu chữ ở `vi.ts` (`expiry.label*`). */
export function expiryLabel(
  end: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!end) return i18n.t('expiry.labelNone');
  const days = daysUntil(end, now);
  if (days < 0) return i18n.t('expiry.labelOverdue', { count: Math.abs(days) });
  if (days === 0) return i18n.t('expiry.labelToday');
  return i18n.t('expiry.labelLeft', { count: days });
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
