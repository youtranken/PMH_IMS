import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** audit_log APPEND-ONLY (AD-10) — tạo bằng migration 0003_audit_log.sql. */
export const auditLogTable = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  objectType: text('object_type'),
  objectId: text('object_id'),
  /*
   * "Từ đâu" của NFR-03. Cột này có trong `0004_audit_log.sql:8` từ ngày đầu nhưng THIẾU ở
   * bảng drizzle suốt 9 epic, nên `toRow()` không map và 100% số dòng NULL (rà soát 07/09,
   * #3). Bảng chỉ-thêm: những dòng cũ không vá ngược được, chỉ chặn được từ đây trở đi.
   */
  ip: text('ip'),
  detail: jsonb('detail'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
