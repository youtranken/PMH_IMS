import { todayIso } from '@/lib/format';
import { daysBetweenIso, shiftIso } from '@/lib/period-range';

/** Một lần phát hành (`GET /diagrams/:id/publications` → `events`). */
export interface PublicationEvent {
  versionId: string;
  seq: number;
  at: string;
}

/**
 * Bản CHÍNH THỨC hiệu lực ngày `day` (YYYY-MM-DD, giờ Việt Nam): lần phát hành cuối cùng có ngày
 * phát hành ≤ `day`. Sự kiện phát hành là nguồn sự thật (Q-23) — cờ chính thức trên cây chỉ nói
 * bản hiện hành. `null` = trước bản chính thức đầu tiên.
 */
export function officialOn(events: PublicationEvent[], day: string): PublicationEvent | null {
  let hit: PublicationEvent | null = null;
  for (const event of [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (todayIso(new Date(event.at)) <= day) hit = event;
  }
  return hit;
}

/** Ngày thứ `n` của thang bắt đầu từ `from`. */
export const dayAt = shiftIso;

/**
 * Thang của thanh trượt: từ HÔM TRƯỚC lần phát hành đầu (để kéo được về "chưa có bản chính thức")
 * tới hôm nay; `days` = số bước.
 */
export function daySpan(events: PublicationEvent[], today: string): { from: string; days: number } {
  if (events.length === 0) return { from: today, days: 0 };
  const first = events.map((e) => todayIso(new Date(e.at))).sort()[0];
  const from = dayAt(first, -1);
  return { from, days: Math.max(0, daysBetweenIso(from, today)) };
}
