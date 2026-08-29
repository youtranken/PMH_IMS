import { Injectable } from '@nestjs/common';
import type { UserRole } from '../auth/types';
import { UsersService } from './users.service';
import type { UserRecord } from './users.types';

/**
 * Whitelist cột sắp xếp — tái xuất qua cửa chính để `auth/accounts.controller.ts` không phải
 * import `users.service` (AD-2). Bản thân whitelist vẫn do `users` định nghĩa: nó là danh sách
 * cột của bảng `users`, chỉ chủ bảng mới được nói cột nào an toàn cho `ORDER BY`.
 */
export { USER_SORT_DEFAULT, USER_SORT_KEYS } from './users.service';
export type { UserSortKey } from './users.service';

/**
 * AD-2: public api DUY NHẤT của module users. Module khác inject class này,
 * KHÔNG import users.service/users.schema và KHÔNG query bảng `users`.
 */
@Injectable()
export class UsersApiService {
  constructor(private readonly users: UsersService) {}

  getById(id: string): Promise<UserRecord | null> {
    return this.users.findById(id);
  }

  /** Người nhận email theo vai — dùng cho outbox/digest (Epic 3) và cảnh báo bảo mật. */
  recipientsByRole(roles: UserRole[]): Promise<{ email: string; fullName: string }[]> {
    return this.users.listRecipients(roles);
  }
}
