import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * audit_log APPEND-ONLY (AD-10). Chia ngăn theo năm (`0011_audit_log.sql`), nên khoá chính thật trong DB là
 * (id, created_at); drizzle không dựng schema nên khai `id` là khoá chính vẫn đúng cho việc đọc.
 */
export const auditLogTable = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  objectType: text('object_type'),
  objectId: text('object_id'),
  /*
   * "Từ đâu" của NFR-03. Cột có trong `0011_audit_log.sql`; thiếu nó ở bảng drizzle thì
   * `toRow()` không map và mọi dòng NULL. Bảng chỉ-thêm: dòng cũ ghi thiếu không vá ngược được.
   */
  ip: text('ip'),
  detail: jsonb('detail'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
