import {
  DEFAULT_EXPIRY_THRESHOLDS,
  daysUntil,
  expiryLabel,
  expiryLevel,
  type ExpiryLevel,
  type ExpiryThresholds,
} from '@/lib/expiry';

/**
 * Quãng đường của một thời hạn — hàm THUẦN, có bảng test.
 *
 * Một cái nhãn chữ ("Còn 157 ngày") cho "bảo hành" trên trang chi tiết chỉ trả lời đúng MỘT
 * câu và giấu mất ba câu còn lại: mua từ bao giờ, hạn chạy từ mốc nào, và đã đi
 * hết bao nhiêu phần đường. Thanh timeline trả lời cả bốn.
 *
 * Mức độ (`level`) KHÔNG tự tính ở đây mà đọc từ `expiryLevel()` dùng chung (AD-15) — nên
 * thanh và badge không bao giờ nói khác nhau, và đổi ngưỡng một chỗ là đổi cả hai.
 */
export interface WarrantyProgress {
  /** Phần trăm quãng đường đã đi, 0–100. `null` khi không biết mốc bắt đầu. */
  percent: number | null;
  level: ExpiryLevel;
  /** Câu ngắn cho badge/chú thích: "Còn 157 ngày", "Quá hạn 34 ngày"… */
  label: string;
  /** Âm = đã quá hạn. */
  daysLeft: number;
  /** Có mốc bắt đầu dùng được không — thiếu thì vẽ thanh "chỉ có đích", không bịa điểm đầu. */
  hasStart: boolean;
}

/**
 * `start` ưu tiên `warrantyStart`, thiếu thì lùi về `purchaseDate` — đúng thứ tự người dùng
 * hiểu: bảo hành thường chạy từ ngày mua, và rất nhiều hồ sơ chỉ khai một trong hai.
 *
 * Trả `null` khi KHÔNG có hạn: không có hạn thì không có quãng đường nào để vẽ, và vẽ một
 * thanh rỗng chỉ làm người đọc tưởng dữ liệu bị mất.
 */
export function warrantyProgress(input: {
  start?: string | null;
  end?: string | null;
  now?: Date;
  /**
   * Hai ngưỡng đang hiệu lực (AD-11). Bỏ trống thì `expiryLevel` dùng mặc định — đúng cho
   * bài kiểm bảng dữ liệu; component gọi thật thì phải truyền từ `useExpiryThresholds()`,
   * nếu không thanh và huy hiệu lại quay về hai luật khác nhau.
   */
  thresholds?: ExpiryThresholds;
}): WarrantyProgress | null {
  const { end } = input;
  if (!end) return null;
  const now = input.now ?? new Date();

  const level = expiryLevel(end, now, input.thresholds ?? DEFAULT_EXPIRY_THRESHOLDS);
  const label = expiryLabel(end, now);
  const daysLeft = daysUntil(end, now);

  const start = input.start ?? null;
  if (!start) return { percent: null, level, label, daysLeft, hasStart: false };

  const total = daysUntil(end, parseDay(start));
  /*
   * Quãng đường dài 0 hoặc âm (mốc đầu nằm SAU mốc cuối — dữ liệu khai nhầm) thì không có tỷ
   * lệ nào có nghĩa. Vẽ thanh "chỉ có đích" thay vì chia cho 0 rồi ra `Infinity`, và cũng
   * đừng im lặng sửa dữ liệu hộ người dùng.
   */
  if (total <= 0) return { percent: null, level, label, daysLeft, hasStart: false };

  const gone = total - daysLeft;
  const percent = Math.min(100, Math.max(0, Math.round((gone / total) * 100)));
  return { percent, level, label, daysLeft, hasStart: true };
}

function parseDay(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  // Dựng theo giờ ĐỊA PHƯƠNG, không qua UTC — cùng lý do với `parseDateOnly` ở `lib/expiry`:
  // ở múi giờ +07 thì `new Date('2026-01-12')` lùi mất một ngày.
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(value);
}
