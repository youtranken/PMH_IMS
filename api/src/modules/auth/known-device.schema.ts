import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Thiết bị đã từng đăng nhập (NFR-01) — bảng tạo bằng migration 0007_known_device.sql.
 *
 * Chủ sở hữu: module `auth` (AD-3). Bảng này từng được khai trong `users/users.schema.ts`
 * dù `auth/known-device.service.ts` là nơi DUY NHẤT đọc/ghi nó — chủ trên giấy chưa bao giờ
 * chạm bảng. Chuyển về đây để "ai khai schema" và "ai ghi" là cùng một module: hôm nào `users`
 * thêm màn "thiết bị đã tin" thì nó phải đi qua api của `auth`, không tự query.
 */
export const knownDeviceTable = pgTable('known_device', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  deviceHash: text('device_hash').notNull(),
  label: text('label'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});
