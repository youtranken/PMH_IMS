import {
  daysBetween,
  pickLoadedSubnets,
  pickRecent,
  pickStaleOwners,
} from './dashboard-rules';

/** Mốc cố định cho mọi trường hợp — không đọc đồng hồ thật ở bất kỳ đâu trong file này. */
const NOW = new Date('2026-08-28T09:00:00.000Z');

/** `NOW` lùi lại `days` ngày. */
function ago(days: number, hours = 0): Date {
  return new Date(NOW.getTime() - days * 86_400_000 - hours * 3_600_000);
}

describe('daysBetween — số ngày trọn vẹn, làm tròn xuống', () => {
  const cases: { name: string; from: Date; expected: number }[] = [
    { name: 'cùng thời điểm', from: NOW, expected: 0 },
    { name: '23 giờ vẫn là 0 ngày', from: ago(0, 23), expected: 0 },
    { name: 'đúng 1 ngày', from: ago(1), expected: 1 },
    { name: '179 ngày 23 giờ vẫn là 179', from: ago(179, 23), expected: 179 },
    { name: 'đúng 180 ngày', from: ago(180), expected: 180 },
    { name: 'mốc ở tương lai ra số âm', from: ago(-3), expected: -3 },
  ];
  for (const { name, from, expected } of cases) {
    it(`${name} → ${expected}`, () => {
      expect(daysBetween(from, NOW)).toBe(expected);
    });
  }
});

describe('pickLoadedSubnets — dải nào gọi là sắp đầy', () => {
  const rows = [
    { id: 'a', percent: 95, total: 254 },
    { id: 'b', percent: 80, total: 254 },
    { id: 'c', percent: 79, total: 254 },
    { id: 'd', percent: 100, total: 62 },
    { id: 'e', percent: 0, total: 0 },
  ];

  it('lấy từ ngưỡng TRỞ LÊN — đúng 80 phải có mặt', () => {
    const picked = pickLoadedSubnets(rows, 80).map((row) => row.id);
    expect(picked).toEqual(['d', 'a', 'b']);
  });

  it('dải không chứa được địa chỉ nào thì không phải "sắp đầy", kể cả khi ngưỡng là 0', () => {
    const picked = pickLoadedSubnets(rows, 0).map((row) => row.id);
    expect(picked).not.toContain('e');
    expect(picked).toHaveLength(4);
  });

  it('đầy nhất lên đầu', () => {
    expect(pickLoadedSubnets(rows, 0).map((row) => row.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('không có dải nào đạt ngưỡng thì trả mảng rỗng, không phải toàn bộ', () => {
    expect(pickLoadedSubnets(rows, 101)).toEqual([]);
  });
});

describe('pickStaleOwners — két lâu không đổi', () => {
  const rows = [
    { ownerId: 'moi', lastChangeAt: ago(10) },
    { ownerId: 'sat-nguong', lastChangeAt: ago(179, 23) },
    { ownerId: 'dung-nguong', lastChangeAt: ago(180) },
    { ownerId: 'rat-cu', lastChangeAt: ago(900) },
  ];

  it('đúng ngày ngưỡng là đã tính, ngày trước đó thì chưa', () => {
    const picked = pickStaleOwners(rows, 180, NOW).map((row) => row.ownerId);
    expect(picked).toEqual(['rat-cu', 'dung-nguong']);
  });

  it('cũ nhất lên đầu và kèm sẵn daysSince để bên gọi khỏi tính lại', () => {
    const [first] = pickStaleOwners(rows, 180, NOW);
    expect(first).toEqual({ ownerId: 'rat-cu', lastChangeAt: ago(900), daysSince: 900 });
  });

  it('không đụng vào mảng gốc', () => {
    const before = rows.map((row) => row.ownerId);
    pickStaleOwners(rows, 0, NOW);
    expect(rows.map((row) => row.ownerId)).toEqual(before);
  });
});

describe('pickRecent — vừa xảy ra trong bao nhiêu ngày', () => {
  const rows = [
    { id: 'hom-nay', updatedAt: ago(0) },
    { id: 'sat-nguong', updatedAt: ago(7) },
    { id: 'qua-han', updatedAt: ago(8) },
    { id: 'khong-ngay', updatedAt: null },
    { id: 'tuong-lai', updatedAt: ago(-30) },
  ];

  it('đúng ngày ngưỡng vẫn tính là "vừa", và mới nhất lên đầu', () => {
    const picked = pickRecent(rows, 7, NOW).map((row) => row.id);
    expect(picked).toEqual(['tuong-lai', 'hom-nay', 'sat-nguong']);
  });

  it('hồ sơ không có ngày thì loại — "không biết" không phải là "vừa"', () => {
    expect(pickRecent(rows, 3650, NOW).map((row) => row.id)).not.toContain('khong-ngay');
  });

  it('mốc ở tương lai vẫn hiện, để có người nhìn thấy dữ liệu sai', () => {
    expect(pickRecent(rows, 7, NOW).map((row) => row.id)).toContain('tuong-lai');
  });
});
