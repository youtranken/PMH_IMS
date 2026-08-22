import {
  customType,
  date,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** citext: mã thiết bị so sánh không phân biệt hoa-thường ("sw-core-01" = "SW-CORE-01"). */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * Bảng `device` + `device_history` — migration 0012. Chủ sở hữu: module `devices` (AD-3).
 * Module khác đọc qua `DevicesApiService`, không import file này (AD-2).
 *
 * Ngày (mua, bảo hành) dùng kiểu `date` THUẦN, không timestamptz: "hết hạn 30/08/2026" là
 * một NGÀY LỊCH, không phải một thời điểm — lưu kèm giờ là tự chuốc lệch múi giờ.
 */
export const deviceTable = pgTable('device', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: citext('code').notNull(),
  name: text('name').notNull(),
  deviceTypeId: uuid('device_type_id').notNull(),
  model: text('model'),
  serial: text('serial'),
  siteId: uuid('site_id'),
  cabinetId: uuid('cabinet_id'),
  vendorId: uuid('vendor_id'),
  assignedTo: text('assigned_to'),
  department: text('department'),
  purchaseDate: date('purchase_date'),
  warrantyStart: date('warranty_start'),
  warrantyEnd: date('warranty_end'),
  status: text('status').notNull().default('in_use'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** AD-13: append-only (trigger `history_append_only` chặn UPDATE/DELETE ở tầng DB). */
export const deviceHistoryTable = pgTable('device_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceId: uuid('device_id').notNull(),
  action: text('action').notNull(),
  actor: text('actor').notNull(),
  changes: jsonb('changes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
