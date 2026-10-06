import {
  boolean,
  customType,
  date,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AccessPoint } from './device-access';
import type { PhysicalPort, PortTemplateGroup } from './port-template';

/** citext: mã thiết bị so sánh không phân biệt hoa-thường ("sw-core-01" = "SW-CORE-01"). */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * Bảng `device` + `device_history` — migration 0020_device.sql. Chủ sở hữu: module `devices` (AD-3).
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
  /** U thấp nhất máy chiếm trong tủ (U1 = đáy) và số U — 0054; cùng có hoặc cùng trống. */
  rackUStart: smallint('rack_u_start'),
  rackUSize: smallint('rack_u_size'),
  /** Ảnh thật của RIÊNG máy này (tệp đính kèm của máy) — thắng ảnh mức model. */
  photoFrontFileId: uuid('photo_front_file_id'),
  photoBackFileId: uuid('photo_back_file_id'),
  /** Model danh mục (0061, Q-26); trống = máy "chưa có Model", khai Số U / ảnh trên chính máy. */
  deviceModelId: uuid('device_model_id'),
  /** Truy cập quản trị (0062): kiểu + địa chỉ + cổng; luật ở `normalizeAccessPoints`. */
  accessPoints: jsonb('access_points').$type<AccessPoint[]>().notNull().default([]),
  /** Cổng vật lý của máy (0063) — KHÔNG phải dây; dây ở `device_port`. Chép từ cổng mẫu lúc gán model. */
  portLayout: jsonb('port_layout').$type<PhysicalPort[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Ảnh thật mức model (0054): một hàng cho mỗi (loại thiết bị, chuỗi model) — Q-23. Tệp ảnh là
 * `file` mang `owner_type = 'device_model'`.
 */
export const deviceModelTable = pgTable('device_model', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceTypeId: uuid('device_type_id').notNull(),
  model: text('model').notNull(),
  /** Hãng sản xuất (chữ) — không phải `vendor` (nhà cung cấp). */
  manufacturer: text('manufacturer'),
  rackMountable: boolean('rack_mountable').notNull().default(false),
  /** Có khi và chỉ khi gắn tủ (CHECK của 0061). */
  uSize: smallint('u_size'),
  /** Cột sinh của Postgres (`modelKey()`): chỉ đọc, không bao giờ ghi. */
  modelKey: text('model_key'),
  /** Cổng mẫu (0063): nhóm `pattern` + `kind`, mở bằng `expandPortTemplate`. */
  portTemplate: jsonb('port_template').$type<PortTemplateGroup[]>().notNull().default([]),
  photoFrontFileId: uuid('photo_front_file_id'),
  photoBackFileId: uuid('photo_back_file_id'),
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

/**
 * Port map — migration 0021_device_port.sql (AD-14). MỘT kết nối = MỘT bản ghi; chiều ngược hiện bằng
 * query trên `connected_device_id`, không có bản ghi đối xứng.
 */
export const devicePortTable = pgTable('device_port', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceId: uuid('device_id').notNull(),
  portLabel: text('port_label').notNull(),
  connectedDeviceId: uuid('connected_device_id'),
  connectedLabel: text('connected_label'),
  connectedPort: text('connected_port'),
  usedBy: text('used_by'),
  /** VLAN của cổng — text vì "trunk" là giá trị có thật trên cổng uplink. */
  vlan: text('vlan'),
  note: text('note'),
  /** Loại dây (0048) — danh mục `cable_type` của `catalog`; `null` = chưa khai. */
  cableTypeId: uuid('cable_type_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
