import { valueAge } from './secret-age';

const NOW = new Date('2026-09-28T10:00:00Z');
const daysAgo = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * 86_400_000 - extraMs);

describe('valueAge — giá trị trong ngăn đã bao lâu chưa đổi', () => {
  it.each([
    // [ngày trước, ngưỡng, số ngày, quá ngưỡng]
    [0, 180, 0, false],
    [179, 180, 179, false],
    // Ngày thứ 180 là đúng ngưỡng người vận hành đặt — phải hiện, không đợi ngày 181.
    [180, 180, 180, true],
    [400, 180, 400, true],
  ])('%i ngày, ngưỡng %i → %i ngày, stale=%s', (ago, staleDays, days, stale) => {
    expect(valueAge(daysAgo(ago), staleDays, NOW)).toEqual({ days, stale });
  });

  it('chưa tròn ngày thì làm tròn XUỐNG: 179 ngày 23 giờ chưa tới ngưỡng 180', () => {
    expect(valueAge(daysAgo(179, 23 * 3_600_000), 180, NOW)).toEqual({ days: 179, stale: false });
  });

  it('đồng hồ máy chủ lệch về trước mốc đổi: không ra số âm', () => {
    expect(valueAge(new Date(NOW.getTime() + 60_000), 180, NOW)).toEqual({ days: 0, stale: false });
  });
});
