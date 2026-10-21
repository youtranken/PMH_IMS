import { customType, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** Nhóm quyền của Thành viên (Q-31) — migration 0076. Chủ sở hữu: module users (AD-3). */
export const featureGroupTable = pgTable('feature_group', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: citext('name').notNull(),
  features: text('features').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
