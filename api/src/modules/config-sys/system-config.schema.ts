import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** AD-11: tham số vận hành — bảng + giá trị gieo ở migration 0004_system_config.sql. */
export const systemConfigTable = pgTable('system_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});
