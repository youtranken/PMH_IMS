import { serviceAccountStatusQuery } from './service-account-rules';

/*
 * Q-20 — màn Tài khoản dịch vụ mặc định gửi `?status=active` (ẩn tài khoản đã ngừng dùng). Chữ
 * lạ coi như mặc định đó; trước đây nó đi thẳng xuống `WHERE status = 'abc'` và ra bảng rỗng.
 */
describe('serviceAccountStatusQuery — đọc ?status= của danh sách / file xuất', () => {
  it.each<[unknown, string | undefined]>([
    [undefined, undefined],
    ['', undefined],
    ['active', 'active'],
    ['disabled', 'disabled'],
    ['dead', 'active'],
    [['active', 'disabled'], 'active'],
  ])('%j → %j', (value, expected) => {
    expect(serviceAccountStatusQuery(value)).toBe(expected);
  });
});
