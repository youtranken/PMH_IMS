import { softwareStatusQuery } from './software-rules';

/*
 * Q-20 — màn Phần mềm mặc định gửi `?status=live` (ẩn phần mềm đã thanh lý). Vắng tham số là
 * không lọc (⌘K tìm cả hồ sơ đã thanh lý); chữ lạ coi như mặc định `live`.
 */
describe('softwareStatusQuery — đọc ?status= của danh sách / file xuất phần mềm', () => {
  it.each<[unknown, string | undefined]>([
    [undefined, undefined],
    ['', undefined],
    ['live', 'live'],
    ['active', 'active'],
    ['expired_ok', 'expired_ok'],
    ['retired', 'retired'],
    ['dead', 'live'],
    [['live', 'retired'], 'live'],
  ])('%j → %j', (value, expected) => {
    expect(softwareStatusQuery(value)).toBe(expected);
  });
});
