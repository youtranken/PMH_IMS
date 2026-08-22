import { date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Lịch sử gia hạn — migration 0017. Chủ sở hữu: module `expiry` (AD-3).
 *
 * `object_kind` + `object_id` là tham chiếu LỎNG, không có khóa ngoại: engine không được
 * biết bảng nào tồn tại (AD-2/AD-7). Append-only theo AD-13.
 */
export const renewalHistoryTable = pgTable('renewal_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  objectKind: text('object_kind').notNull(),
  objectId: uuid('object_id').notNull(),
  label: text('label').notNull(),
  oldEnd: date('old_end'),
  newEnd: date('new_end').notNull(),
  actor: text('actor').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
