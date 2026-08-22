import { Injectable } from '@nestjs/common';
import type { UserRole } from '../auth/types';
import { UsersService } from './users.service';
import type { UserRecord } from './users.types';

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
