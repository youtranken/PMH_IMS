import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Bảng `approval` + `approval_history` — migration 0023. Chủ sở hữu: `approvals` (AD-3).
 *
 * `state` là `text` TRẦN, không enum, không CHECK: từ vựng đăng ký theo LOẠI (AD-6). Đổi lại,
 * `ApprovalService.transition()` là đường duy nhất ghi cột này.
 */
export const approvalTable = pgTable('approval', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  state: text('state').notNull(),
  requester: text('requester').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  reason: text('reason').notNull(),
  payload: jsonb('payload'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  /** NGUỒN SỰ THẬT về hiệu lực (AD-6) — `state` chỉ nói "đã có người duyệt". */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /** Phiên đăng nhập đã GỬI yêu cầu (0170) — chỉ để tra vết, không gác quyền nào. */
  requesterSessionId: uuid('requester_session_id'),
  /**
   * Phiên đang GIỮ grant (0240, Q-15): phiên đã dùng grant lần đầu. NULL = chưa ai dùng. KHÔNG
   * trả ra ngoài trong `ApprovalRecord` — id phiên không đi ra màn hình.
   */
  claimedSessionId: uuid('claimed_session_id'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** AD-13: append-only. FR-025 đọc bảng này để dựng nhật ký break-glass trên dashboard. */
export const approvalHistoryTable = pgTable('approval_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  approvalId: uuid('approval_id').notNull(),
  action: text('action').notNull(),
  actor: text('actor').notNull(),
  fromState: text('from_state'),
  toState: text('to_state'),
  detail: jsonb('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
