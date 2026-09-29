import { valueAge } from './secret-age';

const NOW = new Date('2026-09-28T10:00:00Z');
const daysAgo = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * 86_400_000 - extraMs);

describe('valueAge — giá trị trong ngăn đã bao lâu chưa đổi', () => {
  it.each([
    // [ngày trước, ngưỡng, số ngày, quá ngưỡng, còn bao nhiêu ngày tới hạn (âm = đã quá)]
    [0, 180, 0, false, 180],
    [179, 180, 179, false, 1],
    // Ngày thứ 180 là đúng ngưỡng người vận hành đặt — phải hiện, không đợi ngày 181.
    [180, 180, 180, true, 0],
    [400, 180, 400, true, -220],
  ])('%i ngày, ngưỡng %i → %i ngày, stale=%s, còn %i', (ago, staleDays, days, stale, dueInDays) => {
    expect(valueAge(daysAgo(ago), staleDays, NOW)).toEqual({ days, stale, dueInDays });
  });

  it('chưa tròn ngày thì làm tròn XUỐNG: 179 ngày 23 giờ chưa tới ngưỡng 180', () => {
    expect(valueAge(daysAgo(179, 23 * 3_600_000), 180, NOW)).toEqual({
      days: 179,
      stale: false,
      dueInDays: 1,
    });
  });

  it('đồng hồ máy chủ lệch về trước mốc đổi: không ra số âm', () => {
    expect(valueAge(new Date(NOW.getTime() + 60_000), 180, NOW)).toEqual({
      days: 0,
      stale: false,
      dueInDays: 180,
    });
  });
});
