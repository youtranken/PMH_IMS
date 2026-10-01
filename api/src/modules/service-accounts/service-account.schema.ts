import { customType, date, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * `citext` THẬT, cùng quy ước cột `code` với năm bảng kia.
 *
 * `dataType` phải trả `'citext'`, không phải `'text'`: `UNIQUE (lower(code))` chặn được trùng
 * nhưng KHÔNG chữa việc tra cứu — cùng một câu `WHERE code = 'sv-01'`, bảng `citext` tìm ra
 * `SV-01` còn bảng `text` thì không. Đúng loại khác biệt không ai nhớ nổi, và chỉ lộ ra khi
 * có người gõ chữ thường.
 */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * Bảng `service_account` + `service_account_history` — migration 0033_service_account.sql
 * (+ `end_date` ở 0038_service_account_end_date.sql).
 * Chủ sở hữu: module `service-accounts` (AD-3).
 *
 * KHÔNG có cột mật khẩu: mật khẩu nằm ở két sắt (`ownerType: 'service_account'`), bảng này
 * chỉ giữ hồ sơ hành chính — y hệt cách `software` không giữ license key.
 */
export const serviceAccountTable = pgTable('service_account', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: citext('code').notNull(),
  /** 'shared' | 'vpn' — xem `service-account-rules.ts`. */
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  login: text('login'),
  department: text('department'),
  ownerName: text('owner_name'),
  /** Hai cột dưới CHỈ có nghĩa với kind='vpn'. */
  groupName: text('group_name'),
  allowedIps: text('allowed_ips'),
  note: text('note'),
  /** Hạn dùng (Q-20). NULL = không có hạn. Quá hạn chỉ nhắc, không tự ngừng dùng. */
  endDate: date('end_date'),
  status: text('status').notNull().default('active'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const serviceAccountHistoryTable = pgTable('service_account_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceAccountId: uuid('service_account_id').notNull(),
  action: text('action').notNull(),
  actor: text('actor').notNull(),
  changes: jsonb('changes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
