import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { usersTable } from '../users/users.schema';

/** Phiên server-side (AD-8) — bảng tạo bằng migration 0003_sessions.sql. */
export const sessionsTable = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => usersTable.id),
  csrfToken: text('csrf_token').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  steppedUpAt: timestamp('stepped_up_at', { withTimezone: true }),
  totpPending: boolean('totp_pending').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
});
