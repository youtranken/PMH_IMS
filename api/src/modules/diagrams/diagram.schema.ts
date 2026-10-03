import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { CellDiff, CellIndex } from './diagram-cells';

/** Migration 0046_diagram.sql + 0050_diagram_presentation.sql. Chủ sở hữu: module `diagrams` (AD-3, AD-18). */

export const DIAGRAM_NODE_TYPES = ['company', 'site', 'floor', 'room', 'cabinet', 'other'] as const;
export type DiagramNodeType = (typeof DIAGRAM_NODE_TYPES)[number];

export const diagramTable = pgTable('diagram', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentId: uuid('parent_id'),
  name: text('name').notNull(),
  nodeType: text('node_type').$type<DiagramNodeType>().notNull(),
  siteId: uuid('site_id'),
  cabinetId: uuid('cabinet_id'),
  ownerEmail: text('owner_email'),
  kind: text('kind').$type<'official' | 'presentation'>().notNull().default('official'),
  officialVersionId: uuid('official_version_id'),
  /** Bản trình bày: chép từ bản vẽ nào, phiên bản chính thức nào (0050). Bản chính thức: `null`. */
  sourceDiagramId: uuid('source_diagram_id'),
  sourceVersionId: uuid('source_version_id'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedBy: text('archived_by'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Thông tin một thiết bị lúc lưu (AD-14). `missing` = id trên bản vẽ không còn trong kho. */
export interface DeviceSnapshotEntry {
  id: string;
  missing?: boolean;
  code?: string;
  name?: string;
  type?: string;
  model?: string | null;
  serial?: string | null;
  ips?: string[];
  site?: string | null;
  cabinet?: string | null;
  /** U thấp nhất máy chiếm trong tủ lúc lưu (U1 = đáy) và số U; bản lưu trước khi kho có U ghi `null`. */
  u?: number | null;
  uSize?: number | null;
  status?: string;
  /**
   * Cổng của CHÍNH máy này trên từng dây có trên bản vẽ (`ims_link_id` → tên cổng; `''` = chưa ghi)
   * — cảnh báo lệch kho biết "đổi cổng từ lúc vẽ". Phiên bản lưu trước khi có trường này thì vắng.
   */
  ports?: Record<string, string>;
}

export const diagramVersionTable = pgTable('diagram_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  diagramId: uuid('diagram_id').notNull(),
  seq: integer('seq').notNull(),
  xml: text('xml').notNull(),
  svg: text('svg'),
  cellIndex: jsonb('cell_index').$type<CellIndex>().notNull(),
  deviceSnapshot: jsonb('device_snapshot').$type<DeviceSnapshotEntry[]>().notNull(),
  summary: text('summary').notNull(),
  summaryDetail: jsonb('summary_detail').$type<CellDiff>().notNull(),
  basedOnVersionId: uuid('based_on_version_id'),
  restoredFromVersionId: uuid('restored_from_version_id'),
  savedBy: text('saved_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const diagramVersionLabelTable = pgTable('diagram_version_label', {
  id: uuid('id').primaryKey().defaultRandom(),
  diagramId: uuid('diagram_id').notNull(),
  versionId: uuid('version_id').notNull(),
  label: text('label'),
  actor: text('actor').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const diagramHistoryTable = pgTable('diagram_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  diagramId: uuid('diagram_id').notNull(),
  action: text('action').notNull(),
  actor: text('actor').notNull(),
  changes: jsonb('changes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const diagramPresenceTable = pgTable('diagram_presence', {
  id: uuid('id').primaryKey().defaultRandom(),
  diagramId: uuid('diagram_id').notNull(),
  userEmail: text('user_email').notNull(),
  fullName: text('full_name').notNull(),
  seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Migration 0049_diagram_comment.sql — chỉ-thêm; "Đã xử lý"/"Mở lại" là hàng sự kiện. */
export const DIAGRAM_COMMENT_KINDS = ['note', 'resolved', 'reopened'] as const;
export type DiagramCommentKind = (typeof DIAGRAM_COMMENT_KINDS)[number];

/** Toạ độ ô trong ảnh xem lúc ghim — ô bị xoá ở phiên bản sau thì ghim hiện ở đây. */
export interface CommentAnchor {
  x: number;
  y: number;
}

export const diagramCommentTable = pgTable('diagram_comment', {
  id: uuid('id').primaryKey().defaultRandom(),
  diagramId: uuid('diagram_id').notNull(),
  versionId: uuid('version_id').notNull(),
  approvalId: uuid('approval_id'),
  parentId: uuid('parent_id'),
  kind: text('kind').$type<DiagramCommentKind>().notNull().default('note'),
  cellId: text('cell_id'),
  anchor: jsonb('anchor').$type<CommentAnchor>(),
  body: text('body'),
  author: text('author').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Migration 0053_diagram_drift.sql — bộ đệm số lệch kho của bản chính thức (không phải lịch sử). */
export const diagramDriftTable = pgTable('diagram_drift', {
  diagramId: uuid('diagram_id').primaryKey(),
  versionId: uuid('version_id'),
  driftCount: integer('drift_count').notNull().default(0),
  notifiedCount: integer('notified_count').notNull().default(0),
  checkedAt: timestamp('checked_at', { withTimezone: true }),
  sweptAt: timestamp('swept_at', { withTimezone: true }),
});
