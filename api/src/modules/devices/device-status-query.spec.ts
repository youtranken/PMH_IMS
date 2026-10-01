import { deviceStatusQuery } from './devices.types';

/*
 * Q-20 — màn Thiết bị mặc định ẩn máy đã thanh lý bằng `?status=live`; lọc đích danh
 * `?status=retired` vẫn ra. Chữ lạ coi như bộ lọc mặc định `live` (Q-20) — bỏ qua (không lọc)
 * là lặng lẽ bày lại máy đã thanh lý.
 */
describe('deviceStatusQuery — đọc ?status= của danh sách / file xuất thiết bị', () => {
  it.each<[unknown, string | undefined]>([
    [undefined, undefined],
    ['', undefined],
    ['live', 'live'],
    ['in_use', 'in_use'],
    ['spare', 'spare'],
    ['broken', 'broken'],
    ['retired', 'retired'],
    ['dead', 'live'],
    [['live', 'retired'], 'live'],
  ])('%j → %j', (value, expected) => {
    expect(deviceStatusQuery(value)).toBe(expected);
  });
});
