import { useEffect, useRef, useState } from 'react';
import { motionReduced } from '@/lib/motion';

/** Thời gian đếm từ 0 lên (Q-21): đủ để mắt thấy con số "chạy", không đủ để phải chờ đọc. */
export const COUNT_UP_MS = 600;

/**
 * Con số hiện ra bằng cách đếm từ 0 lên `value`, CHỈ ở lần hiện đầu tiên.
 *
 * Dùng vòng khung hình (rAF) chứ không `@property` + `counter()` của CSS: số do CSS vẽ nằm ở
 * `::after`, trình đọc màn hình và lệnh tìm chữ trong trang không thấy nó.
 *
 * Giá trị đổi về sau (bấm Tải lại) thì nhảy thẳng: đếm lại từ 0 mỗi lần làm người xem tưởng số
 * vừa rơi về 0. "Tắt" chuyển động / máy báo giảm chuyển động thì trả ngay giá trị cuối.
 */
export function useCountUp(value: number, { durationMs = COUNT_UP_MS, enabled = true }: { durationMs?: number; enabled?: boolean } = {}): number {
  const [finished, setFinished] = useState(() => !enabled || value <= 0 || motionReduced());
  const [shown, setShown] = useState(0);
  // Đích đọc qua ref: số đổi giữa lúc đang đếm thì đếm thẳng tới số mới, không khởi động lại.
  const target = useRef(value);
  target.current = value;

  useEffect(() => {
    if (finished) return;
    let frame = 0;
    let start: number | null = null;
    const step = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      // Chậm dần về cuối: số lớn chạy nhanh lúc đầu rồi "đậu" vào giá trị thật.
      const eased = 1 - (1 - t) ** 3;
      if (t < 1) {
        setShown(Math.round(target.current * eased));
        frame = requestAnimationFrame(step);
      } else {
        setFinished(true);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [finished, durationMs]);

  return finished ? value : shown;
}
