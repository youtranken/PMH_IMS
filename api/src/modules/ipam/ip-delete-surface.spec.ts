import { PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/roles.decorator';
import { IpamController } from './ipam.controller';

/**
 * Q-15 — hồ sơ IP nhập nhầm: "Xóa" để nhập lại, KHÔNG khôi phục trên giao diện.
 *
 * Cửa khôi phục ở API vẫn giữ (nối lại lịch sử cho đúng hồ sơ cũ khi thật cần) nhưng hẹp lại
 * còn SA: Admin bấm Xóa được, còn đảo ngược thì phải qua người giữ quyền cao nhất và để vết
 * trong nhật ký. Khoá ở đây để một lần "mở cho cùng quyền với Xóa" không lặng lẽ quay lại.
 */
describe('Surface xóa / khôi phục hồ sơ IP', () => {
  const proto = IpamController.prototype as unknown as Record<string, object>;

  it('Xóa (DELETE addresses/:id): SA + Admin', () => {
    const handler = proto.voidAddress;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('addresses/:id');
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['sa', 'admin']);
  });

  it('Khôi phục (POST addresses/:id/restore): chỉ SA', () => {
    const handler = proto.restoreAddress;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('addresses/:id/restore');
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['sa']);
  });
});
