import { accountStatusQuery } from './accounts.controller';

/*
 * Q-20 — màn Người dùng IMS mặc định gửi `?status=live` (ẩn tài khoản đã vô hiệu hóa); lọc đích
 * danh `disabled` mới hiện. Chữ lạ coi như mặc định thay vì 400 làm cả màn thành trang lỗi.
 */
describe('accountStatusQuery — đọc ?status= của danh sách / file xuất tài khoản', () => {
  it.each<[unknown, string | undefined]>([
    [undefined, undefined],
    ['', undefined],
    ['live', 'live'],
    ['active', 'active'],
    ['locked', 'locked'],
    ['disabled', 'disabled'],
    ['dead', 'live'],
    [['active', 'locked'], 'live'],
  ])('%j → %j', (value, expected) => {
    expect(accountStatusQuery(value)).toBe(expected);
  });
});
