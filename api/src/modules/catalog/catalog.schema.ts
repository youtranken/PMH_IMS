import {
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** citext: mã/tên danh mục so sánh không phân biệt hoa-thường ("r01" = "R01"). */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * Bảng danh mục — tạo bằng migration 0010. Chủ sở hữu: module `catalog` (AD-3).
 * Module khác KHÔNG import file này; đi qua `CatalogApiService` (AD-2).
 */
export const siteTable = pgTable('site', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: citext('code').notNull(),
  name: text('name').notNull(),
  address: text('address'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cabinetTable = pgTable('cabinet', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id').notNull(),
  code: citext('code').notNull(),
  description: text('description'),
  uHeight: integer('u_height'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deviceTypeTable = pgTable('device_type', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: citext('name').notNull(),
  hasPortMap: boolean('has_port_map').notNull().default(false),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const vendorTable = pgTable('vendor', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: citext('name').notNull(),
  supplies: text('supplies'),
  phone: text('phone'),
  contact: text('contact'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Ba danh mục của migration 0028 — cùng chủ, cùng nếp `active` (vô hiệu chứ không xóa).
 *
 * Chúng ra đời vì cùng một lý do: ba ô đang gõ tay tự do, gõ mỗi nơi một kiểu, nên lọc ra
 * thiếu và báo cáo cộng nhầm.
 */
export const departmentTable = pgTable('department', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: citext('name').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ispProviderTable = pgTable('isp_provider', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: citext('name').notNull(),
  hotline: text('hotline'),
  contact: text('contact'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const servicePortTable = pgTable('service_port', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: citext('name').notNull(),
  /** 'tcp' | 'udp' | 'both' — CHECK ở tầng DB (0028). */
  protocol: text('protocol').notNull().default('tcp'),
  portFrom: integer('port_from').notNull(),
  portTo: integer('port_to').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** AD-13: append-only (trigger `history_append_only` chặn UPDATE/DELETE ở tầng DB). */
export const catalogHistoryTable = pgTable('catalog_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  entity: text('entity').notNull(),
  entityId: uuid('entity_id').notNull(),
  action: text('action').notNull(),
  actor: text('actor').notNull(),
  changes: jsonb('changes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
