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
});
