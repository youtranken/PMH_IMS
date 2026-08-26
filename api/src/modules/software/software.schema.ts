import {
  bigint,
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
  /** 'subscription' | 'perpetual' — chỉ có nghĩa với kind='license' (0026). */
  licenseModel: text('license_model').notNull().default('subscription'),
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

/**
 * Gán license vào thiết bị — migration 0015. CÙNG module `software` sở hữu (AD-3): bảng nói
 * về license, và license là tài sản của software.
 *
 * Gỡ gán KHÔNG xóa dòng mà đánh dấu `released_at` — "key này từng nhập máy nào" là câu hỏi
 * kiểm toán hay gặp nhất khi rà license.
 */
export const licenseAssignmentTable = pgTable('license_assignment', {
  id: uuid('id').primaryKey().defaultRandom(),
  softwareId: uuid('software_id').notNull(),
  deviceId: uuid('device_id').notNull(),
  assignedBy: text('assigned_by').notNull(),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  releasedBy: text('released_by'),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  overSeatReason: text('over_seat_reason'),
  note: text('note'),
  /**
   * Kỳ hạn + chi phí RIÊNG của từng ghế (0027). Một license 10 ghế thường gồm nhiều đợt mua,
   * mỗi đợt một hợp đồng, một giá, một kỳ — nhét vào hồ sơ chung là mất hết thông tin đó.
   */
  cost: bigint('cost', { mode: 'number' }),
  contract: text('contract'),
  startDate: date('start_date'),
  endDate: date('end_date'),
});

/**
 * Đường truyền ISP — migration 0016. Cùng module `software` sở hữu (AD-3): đều là "hợp đồng
 * có ngày gia hạn", và spine chỉ khai 8 module nghiệp vụ, không có module `isp` riêng.
 */
export const ispLineTable = pgTable('isp_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: citext('code').notNull(),
  provider: text('provider').notNull(),
  bandwidth: text('bandwidth'),
  wanIp: text('wan_ip'),
  siteId: uuid('site_id'),
  deviceId: uuid('device_id'),
  hotline: text('hotline'),
  contractNo: text('contract_no'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  note: text('note'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** AD-13: append-only (trigger `history_append_only` chặn UPDATE/DELETE ở tầng DB). */
export const ispLineHistoryTable = pgTable('isp_line_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  ispLineId: uuid('isp_line_id').notNull(),
  action: text('action').notNull(),
  actor: text('actor').notNull(),
  changes: jsonb('changes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
