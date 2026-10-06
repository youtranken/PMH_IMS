import { ROLES_KEY } from '../auth/roles.decorator';
import { DevicePhotosController } from './device-photos.controller';

/**
 * Ai đổi được hình trên sơ đồ (Q-23): ảnh RIÊNG của một máy — ai sửa được hồ sơ máy; ảnh
 * theo MODEL đổi hình của cả loạt máy cùng loại + model — chỉ SA/Admin.
 */
const rolesOf = (handler: keyof DevicePhotosController) =>
  Reflect.getMetadata(ROLES_KEY, Object.getOwnPropertyDescriptor(DevicePhotosController.prototype, handler)!.value as object) as string[];

describe('DevicePhotosController — vai được đổi ảnh', () => {
  it.each([
    ['setDevicePhotos', ['sa', 'admin', 'member']],
    ['list', ['sa', 'admin', 'member']],
    ['preview', ['sa', 'admin', 'member']],
    ['ensureModel', ['sa', 'admin']],
    ['setModelPhotos', ['sa', 'admin']],
  ] as const)('%s → %j', (handler, roles) => {
    expect(rolesOf(handler)).toEqual(roles);
  });
});
