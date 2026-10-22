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
 * Bảng danh mục — migration 0012_site … 0019_catalog_history. Chủ sở hữu: module `catalog` (AD-3).
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
  isRouter: boolean('is_router').notNull().default(false),
  description: text('description'),
  diagramShape: text('diagram_shape'),
  /** Biểu tượng trên giao diện (danh sách đóng `DEVICE_TYPE_ICONS`); null = biểu tượng chung. */
  icon: text('icon'),
  /** Ảnh riêng — tệp `files` của chính loại này, thắng biểu tượng (migration 0077). */
  photoFileId: uuid('photo_file_id'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Biểu tượng SVG riêng (đã lọc) của một loại — migration 0047, bảng riêng để danh sách danh mục không kéo SVG theo. */
export const deviceTypeIconTable = pgTable('device_type_icon', {
  deviceTypeId: uuid('device_type_id').primaryKey(),
  svg: text('svg').notNull(),
  updatedBy: text('updated_by').notNull(),
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
 * Ba danh mục bộ phận / nhà mạng / dịch vụ — cùng chủ, cùng nếp `active` (vô hiệu chứ không xóa).
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
  /** 'tcp' | 'udp' | 'both' — CHECK ở tầng DB. */
  protocol: text('protocol').notNull().default('tcp'),
  portFrom: integer('port_from').notNull(),
  portTo: integer('port_to').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Loại dây (0048, Q-23). Màu là MỘT Ô màu token (`--diagram-cable-<n>`), không phải mã màu: đổi
 * theme hay bảng màu không phải sửa dữ liệu, và không ai gõ được hex vào danh mục.
 */
export const cableTypeTable = pgTable('cable_type', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: citext('name').notNull(),
  colorSlot: integer('color_slot').notNull(),
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
