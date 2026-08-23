import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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

/**
 * Luật gửi báo cáo tổng hợp — migration 0018. Chủ sở hữu: module `expiry` (AD-3).
 *
 * MỘT luật = MỘT email tổng hợp theo kỳ, không phải mail lẻ từng món (FR-013).
 * `last_sent_at` là mốc chống gửi trùng: sweep chạy mỗi phút, thiếu nó thì một sáng gửi 60 lần.
 */
export const expiryRuleTable = pgTable('expiry_rule', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kinds: jsonb('kinds').notNull().default([]),
  withinDays: integer('within_days').notNull().default(30),
  recipients: jsonb('recipients').notNull().default([]),
  frequency: text('frequency').notNull().default('weekly'),
  hour: integer('hour').notNull().default(8),
  weekday: integer('weekday'),
  dayOfMonth: integer('day_of_month'),
  active: boolean('active').notNull().default(true),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
