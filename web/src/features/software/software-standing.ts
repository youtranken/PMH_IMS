import { daysUntil } from '@/lib/expiry';
import type { LicenseModel, SoftwareStatus } from './software-types';

/**
 * Cột "Tình trạng" của hồ sơ phần mềm: MỘT câu trả lời gộp trạng thái Q-03 với số ngày.
 *
 * Hai cột "Tình trạng hạn" + "Trạng thái" đứng cạnh nhau từng nói cùng một chuyện bằng hai chữ
 * ("Quá hạn 10 ngày" và "Hết hạn"). Ở đây trạng thái quyết badge, số ngày chỉ là dòng phụ; hồ
 * sơ Đang dùng có hạn thì badge đếm ngày đã đủ (màu của nó là nhãn "sắp hết hạn" của Q-03).
 *
 * Trả MỘT hình dạng (tsconfig web không bật `strict`). Ngày tính qua `daysUntil` — luật ngày
 * duy nhất của web (AD-15).
 */
type StandingKind = 'countdown' | 'perpetual' | 'noEnd' | 'expired' | 'retired';

export interface Standing {
  kind: StandingKind;
  /** Hết hạn: đã quá bao nhiêu ngày. */
  overdueDays: number | null;
  /** Hết hạn: còn bao nhiêu ngày thì hệ thống tự thanh lý; `null` = tự thanh lý đang tắt. */
  retireInDays: number | null;
}

export function standingOf(
  row: {
    status: SoftwareStatus;
    licenseModel: LicenseModel;
    endDate: string | null;
    autoRetireOn: string | null;
  },
  now: Date = new Date(),
): Standing {
  if (row.status === 'retired') return { kind: 'retired', overdueDays: null, retireInDays: null };
  if (row.status === 'expired_ok') {
    return {
      kind: 'expired',
      overdueDays: row.endDate ? Math.max(0, -daysUntil(row.endDate, now)) : null,
      // Lượt quét chạy theo lịch, nên có thể qua ngày mà chưa kịp chạy: nói 0, đừng nói âm.
      retireInDays: row.autoRetireOn ? Math.max(0, daysUntil(row.autoRetireOn, now)) : null,
    };
  }
  if (row.licenseModel === 'perpetual') {
    return { kind: 'perpetual', overdueDays: null, retireInDays: null };
  }
  return {
    kind: row.endDate ? 'countdown' : 'noEnd',
    overdueDays: null,
    retireInDays: null,
  };
}

/**
 * Cờ đỏ cạnh phân số ghế: dùng đủ ("Hết ghế", `over = 0`) hoặc vượt ("+N vượt"). `null` khi
 * còn ghế hoặc không giới hạn ghế.
 */
export function seatFlag(used: number, total: number | null): { over: number } | null {
  if (total === null || used < total) return null;
  return { over: used - total };
}

/** Hồ sơ bị thanh lý sau hạn bao nhiêu ngày — cho băng "tự động sau N ngày hết hạn". */
export function retiredAfterDays(endDate: string | null, retiredAt: Date): number | null {
  if (!endDate) return null;
  const [y, m, d] = endDate.split('-').map(Number);
  return daysUntil(retiredAt, new Date(y, m - 1, d));
}

/** Ngày lịch địa phương dạng YYYY-MM-DD — cùng hệ ngày với `DatePicker`. */
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Nút "+1 năm" của hộp Khôi phục. 29/02 lùi về 28/02, không tràn sang tháng 3. */
export function plusOneYear(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const lastDay = new Date(y + 1, m, 0).getDate();
  return isoDay(new Date(y + 1, m - 1, Math.min(d, lastDay)));
}

/**
 * Hạn mới của hộp Khôi phục. Hạn cũ hơn hôm nay thì API từ chối (`RESTORE_NEEDS_FUTURE_END`)
 * vì lượt quét kế tiếp sẽ lại tự thanh lý — chặn ngay ở hộp cho khỏi đi một vòng.
 */
export function restoreEndReason(
  end: string,
  today: string,
  needed: boolean,
): 'required' | 'past' | null {
  if (!end) return needed ? 'required' : null;
  return end < today ? 'past' : null;
}

export interface FormerDevice {
  deviceId: string;
  deviceCode: string;
  deviceName: string;
}

/**
 * "Các máy từng dùng" — từ lịch sử ghế đã gỡ: mỗi máy một lần, máy gỡ gần nhất lên đầu (thường
 * là đợt gỡ lúc thanh lý). Máy còn đang giữ ghế thì không mời gán lại.
 */
export function formerDevices(
  rows: (FormerDevice & { releasedAt: string | null })[],
): FormerDevice[] {
  const holding = new Set(rows.filter((row) => !row.releasedAt).map((row) => row.deviceId));
  const seen = new Set<string>();
  const result: FormerDevice[] = [];
  const released = rows
    .filter((row) => row.releasedAt && !holding.has(row.deviceId))
    .sort((a, b) => (b.releasedAt ?? '').localeCompare(a.releasedAt ?? ''));
  for (const row of released) {
    if (seen.has(row.deviceId)) continue;
    seen.add(row.deviceId);
    result.push({ deviceId: row.deviceId, deviceCode: row.deviceCode, deviceName: row.deviceName });
  }
  return result;
}
