import { pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/** Bản thử draw.io — migration 0043_diagram_spike.sql. Chủ sở hữu: module `diagrams` (AD-3). */
export const diagramSpikeTable = pgTable('diagram_spike', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 60 }).notNull(),
  xml: text('xml').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
