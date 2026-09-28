import {
  customType,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** Cột nhị phân cho năm trường envelope — drizzle chưa có kiểu bytea sẵn. */
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/**
 * Bảng `secret` — migration 0019. Chủ sở hữu DUY NHẤT: module `vault` (AD-4).
 *
 * dependency-cruiser có luật `secret-table-only-in-vault`: bất kỳ file nào ngoài
 * `src/modules/vault/` import file này là CI đỏ. Đây là hàng rào máy, không phải lời hứa.
 *
 * Năm cột envelope (NFR-02) — plaintext không bao giờ có mặt ở đây.
 */
export const secretTable = pgTable('secret', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerType: text('owner_type').notNull(),
  ownerId: uuid('owner_id').notNull(),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  username: text('username'),
  valueCt: bytea('value_ct').notNull(),
  valueIv: bytea('value_iv').notNull(),
  valueTag: bytea('value_tag').notNull(),
  dekWrapped: bytea('dek_wrapped').notNull(),
  keyVersion: integer('key_version').notNull(),
  note: text('note'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: text('revoked_by'),
  /** Lúc GIÁ TRỊ đổi lần cuối (cất/đổi giá trị) — `updated_at` nhảy cả khi sửa ghi chú (0150). */
  valueChangedAt: timestamp('value_changed_at', { withTimezone: true }).notNull().defaultNow(),
  valueChangedBy: text('value_changed_by'),
});

/** citext: email so không phân biệt hoa-thường — `IT01@` và `it01@` là một người. */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * Bảng `access_list` — migration 0024 (story 6.2). Chủ sở hữu: `vault` (AD-3).
 *
 * Chỉ chứa `whitelist` và `needs_approval`. CẤM là mặc định (không có dòng), không phải một
 * lời gán — xem `access-tier.ts`.
 */
export const accessListTable = pgTable('access_list', {
  id: uuid('id').primaryKey().defaultRandom(),
  memberEmail: citext('member_email').notNull(),
  scopeType: text('scope_type').notNull(),
  scopeRef: text('scope_ref').notNull(),
  tier: text('tier').notNull(),
  grantedBy: text('granted_by').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
