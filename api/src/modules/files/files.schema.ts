import { bigint, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Bảng `file` — migration 0010_file.sql. Chủ sở hữu: module `files` (AD-3).
 *
 * Nội dung file nằm trên volume, tên đĩa là `stored_name` (uuid, không đoán được);
 * DB chỉ giữ metadata. Xóa là XÓA MỀM (`deleted_at`): biên bản mua thiết bị lỡ tay xóa
 * mà mất hẳn thì không lấy lại được, còn giữ lại thì chỉ tốn ổ đĩa.
 *
 * `owner_type` + `owner_id` để một module file phục vụ mọi chủ thể: thiết bị, phần mềm,
 * phiếu ISO, sự cố — không đẻ mỗi nơi một bảng đính kèm.
 */
export const filesTable = pgTable('file', {
  id: uuid('id').primaryKey().defaultRandom(),
  originalName: text('original_name').notNull(),
  storedName: text('stored_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  ownerType: text('owner_type').notNull(),
  ownerId: uuid('owner_id').notNull(),
  uploadedBy: uuid('uploaded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
