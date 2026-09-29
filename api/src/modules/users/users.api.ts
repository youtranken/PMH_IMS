import { Injectable } from '@nestjs/common';
import type { UserRole } from '../auth/types';
import { UsersService } from './users.service';
import type { UserDirectoryEntry, UserRecord } from './users.types';

/**
 * Whitelist cột sắp xếp — tái xuất qua cửa chính để `auth/accounts.controller.ts` không phải
 * import `users.service` (AD-2). Bản thân whitelist vẫn do `users` định nghĩa: nó là danh sách
 * cột của bảng `users`, chỉ chủ bảng mới được nói cột nào an toàn cho `ORDER BY`.
 */
export { USER_SORT_DEFAULT, USER_SORT_KEYS } from './users.service';
export type { UserListFilters } from './users.service';

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

  /** `id → họ tên` theo mẻ — người tải giấy tờ lên. Id không còn tài khoản thì vắng khỏi map. */
  namesByIds(ids: string[]): Promise<Map<string, string>> {
    return this.users.namesByIds(ids);
  }

  /** `id → email` theo mẻ — gọi tên tài khoản trên màn Nhật ký. */
  emailsByIds(ids: string[]): Promise<Map<string, string>> {
    return this.users.emailsByIds(ids);
  }

  /**
   * Mọi tài khoản, chỉ id · email · họ tên · vai · trạng thái — màn gán quyền két của SA/Admin.
   * Cửa hẹp này tồn tại để màn đó KHÔNG phải mượn `/accounts` (chỉ SA, trả đủ hồ sơ nhân sự).
   */
  directory(): Promise<UserDirectoryEntry[]> {
    return this.users.directory();
  }

  /** Người nhận email theo vai — dùng cho outbox/digest và cảnh báo bảo mật. */
  recipientsByRole(roles: UserRole[]): Promise<{ email: string; fullName: string }[]> {
    return this.users.listRecipients(roles);
  }

  /**
   * Vai hiện tại của người xin break-glass — người duyệt cần biết "Member hay Admin" để đánh giá
   * rủi ro. Chỉ trả vai, không trả gì khác của tài khoản.
   */
  roleByEmail(email: string): Promise<UserRole | null> {
    return this.users.roleByEmail(email);
  }

  /**
   * `email → họ tên` cho một mẻ email. Khóa của map đã hạ chữ thường — tra bằng
   * `map.get(email.toLowerCase())`.
   *
   * Cửa này có để viewer audit không tự viết `LEFT JOIN users u ON u.email = a.actor`. Câu
   * JOIN kiểu ấy không cổng nào nhìn thấy: eslint khớp chuỗi import, `dependency-cruiser` khớp
   * đường dẫn đã resolve, còn SQL thô thì không phải cái nào trong hai thứ đó. Chỗ ấy do
   * `ad2-raw-sql.spec.ts` canh.
   *
   * Nhận MỘT MẺ chứ không một email: nơi gọi đang dựng một trang danh sách, và một cửa nhận
   * lẻ sẽ được gọi trong vòng lặp — đổi một câu JOIN lấy 50 câu SELECT thì hết lỗ này sang lỗ
   * khác.
   */
  namesByEmails(emails: string[]): Promise<Map<string, string>> {
    return this.users.namesByEmails(emails);
  }
}
