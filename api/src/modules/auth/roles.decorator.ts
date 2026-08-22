import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'ims:roles';

export type AppRole = 'member' | 'admin' | 'sa';

/**
 * AD-9: controller KHÔNG khai `@Roles(...)` thì RolesGuard chặn — quyền mặc định ĐÓNG.
 * Route công khai (login, health) phải khai `@Public()` một cách tường minh.
 */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
