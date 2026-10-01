import { deviceStatusQuery } from './devices.types';

/*
 * Q-20 — màn Thiết bị mặc định ẩn máy đã thanh lý bằng `?status=live`; lọc đích danh
 * `?status=retired` vẫn ra. Chữ lạ trên URL bị bỏ qua (không lọc) thay vì lọt xuống câu truy vấn.
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
    ['dead', undefined],
    [['live', 'retired'], undefined],
  ])('%j → %j', (value, expected) => {
    expect(deviceStatusQuery(value)).toBe(expected);
  });
});
