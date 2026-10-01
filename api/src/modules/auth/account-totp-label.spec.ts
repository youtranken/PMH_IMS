import { totpExportLabel } from './accounts.controller';

/*
 * File Excel tài khoản dùng cùng chữ với màn Người dùng IMS ("kích hoạt", Q-21): người kiểm toán
 * đối chiếu file với màn hình, hai chữ cho một trạng thái là hai trạng thái trong mắt họ.
 */
describe('totpExportLabel — cột "Xác thực 2 lớp" của file xuất tài khoản', () => {
  const at = new Date('2026-10-01T00:00:00Z');
  it.each<[Date | null, boolean, string]>([
    [at, true, 'Đã kích hoạt'],
    [at, false, 'Đã kích hoạt'],
    [null, true, 'Bắt buộc – chưa kích hoạt'],
    [null, false, 'Chưa kích hoạt'],
  ])('enrolledAt=%s, bắt buộc=%s → %s', (totpEnrolledAt, totpLoginRequired, expected) => {
    expect(totpExportLabel({ totpEnrolledAt, totpLoginRequired })).toBe(expected);
  });
});
