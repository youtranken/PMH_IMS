import { describe, expect, it } from 'vitest';
import { countdownTone, type CountdownTone } from './countdown-tone';

/**
 * Cùng một component đếm hai thang rất khác nhau: 60 giây cho một secret, 600 giây cho grace
 * step-up. Bài kiểm này khóa đúng chỗ đó — "còn 60 giây" trên thang 60 là SẮP HẾT, còn trên
 * thang 600 thì vẫn là bình thường… nhưng còn 12 giây thì cả hai đều phải đỏ.
 */
describe('countdownTone — màu của đồng hồ đếm ngược', () => {
  const cases: { name: string; left: number; total: number; tone: CountdownTone }[] = [
    // Thang 60s: một secret.
    { name: '60s: vừa mở', left: 60, total: 60, tone: 'calm' },
    { name: '60s: còn nửa', left: 31, total: 60, tone: 'calm' },
    { name: '60s: chạm nửa', left: 30, total: 60, tone: 'warn' },
    { name: '60s: còn 1/4', left: 15, total: 60, tone: 'warn' },
    { name: '60s: còn 12 giây', left: 12, total: 60, tone: 'urgent' },
    { name: '60s: còn 1 giây', left: 1, total: 60, tone: 'urgent' },
    { name: '60s: hết', left: 0, total: 60, tone: 'urgent' },

    // Thang 600s: grace step-up. 20% của nó là 2 phút — KHÔNG được đỏ suốt 2 phút liền.
    { name: '600s: vừa gõ mã', left: 600, total: 600, tone: 'calm' },
    { name: '600s: còn 5 phút', left: 300, total: 600, tone: 'warn' },
    { name: '600s: còn 2 phút vẫn chưa đỏ', left: 120, total: 600, tone: 'warn' },
    { name: '600s: còn 20 giây vẫn chưa đỏ', left: 20, total: 600, tone: 'warn' },
    { name: '600s: còn 15 giây thì đỏ', left: 15, total: 600, tone: 'urgent' },

    // Biên bẩn: tổng bằng 0 (config hỏng) thì coi như hết, không chia cho 0 ra NaN.
    { name: 'tổng = 0', left: 0, total: 0, tone: 'urgent' },
    { name: 'còn âm (đồng hồ máy nhảy)', left: -3, total: 60, tone: 'urgent' },
  ];

  for (const { name, left, total, tone } of cases) {
    it(`${name} → ${tone}`, () => {
      expect(countdownTone(left, total)).toBe(tone);
    });
  }
});
