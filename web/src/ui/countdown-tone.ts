/**
 * Đồng hồ đếm ngược đổi màu theo phần còn lại — hàm THUẦN để test bằng bảng dữ liệu.
 *
 * Vì sao cần: con số trong hộp hiện secret là thứ người ta liếc chứ không đọc. Một dãy số
 * xám đều tăm tắp thì lúc còn 5 giây trông y hệt lúc còn 50 — người dùng đang gõ dở mật khẩu
 * thì hộp đóng sập, và họ bấm Xem lần nữa (một dòng audit nữa) chỉ vì không ai báo trước.
 *
 * Ba mức, đọc được bằng đuôi mắt: xanh (còn nhiều) → hổ phách (sắp) → đỏ nhấp nháy (sắp hết).
 * Ngưỡng tính theo PHẦN TRĂM chứ không phải số giây cố định, vì cùng một component đếm cả
 * 60 giây (một secret) lẫn 600 giây (grace step-up) — mốc "còn 10 giây" nói lên hai điều
 * hoàn toàn khác nhau ở hai thang đó.
 */
export type CountdownTone = 'calm' | 'warn' | 'urgent';

/** Dưới ngưỡng này là hổ phách / đỏ. Kèm sàn giây để thang 600s không đỏ từ lúc còn 60 giây. */
const WARN_RATIO = 0.5;
const URGENT_RATIO = 0.2;
/** Thang dài (grace 600s) chỉ đỏ khi thật sự sắp hết, dù 20% của nó vẫn là 2 phút. */
const URGENT_MAX_SECONDS = 15;

export function countdownTone(left: number, total: number): CountdownTone {
  if (total <= 0) return 'urgent';
  const remaining = Math.max(0, left);
  const ratio = remaining / total;
  if (ratio <= URGENT_RATIO && remaining <= URGENT_MAX_SECONDS) return 'urgent';
  if (ratio <= WARN_RATIO) return 'warn';
  return 'calm';
}
