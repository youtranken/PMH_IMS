import {
  customType,
  date,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * `cidr` / `inet` — kiểu mạng của Postgres, drizzle chưa có sẵn.
 *
 * Dùng kiểu thật chứ không phải `text` vì đổi lại được ba thứ: phép `<<=` ("nằm trong dải")
 * làm ở tầng DB, sắp xếp đúng thứ tự số học (text thì `.10` đứng trước `.9`), và chuỗi rác
 * không vào nổi bảng.
 */
const cidr = customType<{ data: string }>({ dataType: () => 'cidr' });
const inet = customType<{ data: string }>({ dataType: () => 'inet' });

/**
 * Bảng `subnet` — migration 0020. Chủ sở hữu: module `ipam` (AD-3).
 * Module khác đọc qua `IpamApiService`, không import file này (AD-2).
 */
export const subnetTable = pgTable('subnet', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  cidr: cidr('cidr').notNull(),
  siteId: uuid('site_id'),
  description: text('description'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedBy: text('voided_by'),
  voidReason: text('void_reason'),
});

/**
 * Bảng `ip_address` — migration 0020.
 *
 * `assigned_at` là `date` thuần, không timestamptz: "cấp ngày 23/08" là một NGÀY LỊCH.
 * Lưu kèm giờ là tự chuốc lệch múi giờ, theo đúng nếp của `device.warranty_end`.
 */
export const ipAddressTable = pgTable('ip_address', {
  id: uuid('id').primaryKey().defaultRandom(),
  subnetId: uuid('subnet_id').notNull(),
  address: inet('address').notNull(),
  deviceId: uuid('device_id'),
  usedBy: text('used_by'),
  assignedBy: text('assigned_by').notNull(),
  assignedAt: date('assigned_at'),
  status: text('status').notNull().default('assigned'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedBy: text('voided_by'),
  voidReason: text('void_reason'),
});

/**
 * AD-13: lịch sử vòng đời IP, APPEND-ONLY (trigger `history_append_only` chặn UPDATE/DELETE
 * ở tầng DB). AC 5.2 đòi giữ VĨNH VIỄN — "IP này từng là máy in kế toán" phải trả lời được
 * nhiều năm sau, kể cả khi IP đã cấp lại cho máy khác.
 */
export const ipHistoryTable = pgTable('ip_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipAddressId: uuid('ip_address_id').notNull(),
  action: text('action').notNull(),
  actor: text('actor').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  changes: jsonb('changes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
