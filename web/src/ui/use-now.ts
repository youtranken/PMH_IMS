import { useEffect, useState } from 'react';

/**
 * Đồng hồ cho chữ "4 phút trước" / "còn 3 giờ 52 phút" — render lại mỗi `intervalMs`. Chỉ để
 * HIỂN THỊ: quyền có còn hay không vẫn do server phán (AD-6), chữ đếm lùi chỉ đếm từ con số
 * server đưa. `enabled = false` thì không đặt hẹn giờ nào.
 */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, enabled]);
  return now;
}
