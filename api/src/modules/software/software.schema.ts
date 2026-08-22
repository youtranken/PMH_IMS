import {
  customType,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** citext: mã hồ sơ so sánh không phân biệt hoa-thường. */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * Bảng `software` + `software_history` — migration 0014. Chủ sở hữu: module `software` (AD-3).
 *
 * KHÔNG có cột key/mật khẩu: chìa khóa nằm ở két sắt (Epic 4), bảng này chỉ giữ hồ sơ
 * hành chính. Ngày dùng kiểu `date` thuần vì "hết hạn 30/08/2026" là một NGÀY LỊCH.
 */
export const softwareTable = pgTable('software', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: citext('code').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  vendorId: uuid('vendor_id'),
  seatTotal: integer('seat_total'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  note: text('note'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** AD-13: append-only (trigger `history_append_only` chặn UPDATE/DELETE ở tầng DB). */
export const softwareHistoryTable = pgTable('software_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  softwareId: uuid('software_id').notNull(),
  action: text('action').notNull(),
  actor: text('actor').notNull(),
  changes: jsonb('changes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
