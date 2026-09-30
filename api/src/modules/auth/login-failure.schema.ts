import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Bộ đếm gõ sai mật khẩu theo CẶP (người dùng, IP) — bảng tạo bằng
 * `0008_login_failure.sql`. Khoá theo cặp chứ không theo tài khoản: khoá theo tài khoản thì
 * ai biết email cũng khoá được người khác ra ngoài.
 *
 * Chủ sở hữu: module `auth` (AD-3), cùng chỗ với `sessions` và `known_device`. Không đặt bên
 * `users`: bảng này nói về LƯỢT ĐĂNG NHẬP chứ không về hồ sơ người dùng, và `auth.service` là
 * nơi duy nhất đọc/ghi nó. Đặt ở `users` là lặp lại đúng cái đã phải sửa cho `known_device`
 * — chủ trên giấy chưa bao giờ chạm bảng.
 */
export const loginFailureTable = pgTable(
  'login_failure',
  {
    userId: uuid('user_id').notNull(),
    ip: text('ip').notNull(),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.ip] })],
);
