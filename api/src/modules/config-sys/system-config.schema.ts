import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** AD-11: tham số vận hành — migration 0001 + seed 0009. */
export const systemConfigTable = pgTable('system_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});
