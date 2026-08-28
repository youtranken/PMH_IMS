import { describe, expect, it } from 'vitest';
import { warrantyProgress } from './warranty-progress';

const NOW = new Date(2026, 7, 28); // 28/08/2026, giờ địa phương

describe('warrantyProgress — quãng đường của một thời hạn', () => {
  it('không có hạn thì không vẽ gì', () => {
    expect(warrantyProgress({ start: '2025-01-12', end: null, now: NOW })).toBeNull();
    expect(warrantyProgress({ end: undefined, now: NOW })).toBeNull();
  });

  const cases: {
    name: string;
    start: string | null;
    end: string;
    percent: number | null;
    level: string;
  }[] = [
    {
      // 12/01/2025 → 31/12/2026 là 718 ngày; hôm nay còn 125 ngày, tức đã đi 593/718.
      name: 'đi được hơn bốn phần năm',
      start: '2025-01-12',
      end: '2026-12-31',
      percent: 83,
      level: 'ok',
    },
    // Vừa mua hôm nay: chưa đi bước nào.
    { name: 'vừa bắt đầu', start: '2026-08-28', end: '2029-08-28', percent: 0, level: 'ok' },
    // Ngưỡng đọc từ `expiryLevel` dùng chung: ≤30 ngày là 'warning', ≤7 là 'critical'.
    { name: 'còn 25 ngày → cảnh báo', start: '2024-09-01', end: '2026-09-22', percent: 97, level: 'warning' },
    { name: 'còn 3 ngày → gấp', start: '2023-08-01', end: '2026-08-31', percent: 100, level: 'critical' },
    { name: 'quá hạn', start: '2022-07-01', end: '2026-07-24', percent: 100, level: 'expired' },
  ];

  for (const { name, start, end, percent, level } of cases) {
    it(`${name} → ${percent}% / ${level}`, () => {
      const result = warrantyProgress({ start, end, now: NOW })!;
      expect(result.percent).toBe(percent);
      expect(result.level).toBe(level);
      expect(result.hasStart).toBe(true);
    });
  }

  /*
   * Thiếu mốc đầu thì KHÔNG bịa ra một điểm bắt đầu. Thanh vẽ kiểu "chỉ có đích" — vạch ở
   * cuối kèm "còn N ngày" — chứ không vẽ một tỷ lệ mà không ai biết nó tính từ đâu.
   */
  it('thiếu mốc bắt đầu thì không có phần trăm', () => {
    const result = warrantyProgress({ start: null, end: '2026-12-31', now: NOW })!;
    expect(result.percent).toBeNull();
    expect(result.hasStart).toBe(false);
    expect(result.label).toBe('Còn 125 ngày');
  });

  /*
   * Mốc đầu nằm SAU mốc cuối là dữ liệu khai nhầm. Chia cho một quãng âm ra tỷ lệ vô nghĩa
   * (hoặc `Infinity`), nên rơi về thanh "chỉ có đích" — và đừng im lặng sửa hộ người dùng.
   */
  it('mốc đầu sau mốc cuối → không có phần trăm, không nổ', () => {
    const result = warrantyProgress({ start: '2027-01-01', end: '2026-12-31', now: NOW })!;
    expect(result.percent).toBeNull();
    expect(result.hasStart).toBe(false);
  });

  it('bắt đầu và kết thúc cùng ngày cũng không chia cho 0', () => {
    const result = warrantyProgress({ start: '2026-08-28', end: '2026-08-28', now: NOW })!;
    expect(result.percent).toBeNull();
    expect(Number.isFinite(result.daysLeft)).toBe(true);
  });

  it('nhãn dùng chung với badge, không tự viết lại', () => {
    expect(warrantyProgress({ start: '2022-07-01', end: '2026-07-24', now: NOW })!.label).toBe(
      'Quá hạn 35 ngày',
    );
    expect(warrantyProgress({ start: '2026-01-01', end: '2026-08-28', now: NOW })!.label).toBe(
      'Hết hạn hôm nay',
    );
  });
});
