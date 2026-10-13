import { boolean, customType, date, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { BackupDetail } from './iso-rules';

/**
 * Bảng của phiếu ISO đợt 1 — migration 0066_iso_forms.sql. Chủ sở hữu: module `iso-forms` (AD-3).
 * Không trỏ vào kho thiết bị: tên job, tên máy, bộ phận đều gõ tay (Q-28).
 */

/** Cột `code` là citext như mọi bảng khác (0067): tra mã gõ chữ thường vẫn khớp. */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const isoFormOwnerTable = pgTable('iso_form_owner', {
  formType: text('form_type').primaryKey(),
  primaryUserId: uuid('primary_user_id'),
  backupUserId: uuid('backup_user_id'),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const isoBackupJobTable = pgTable('iso_backup_job', {
  id: uuid('id').primaryKey().defaultRandom(),
  no: integer('no').notNull(),
  name: text('name').notNull(),
  trackedFrom: date('tracked_from').notNull(),
  /** Ngày cuối còn theo dõi; NULL = đang theo dõi. */
  stoppedOn: date('stopped_on'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const isoBackupLineTable = pgTable('iso_backup_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull(),
  sortOrder: integer('sort_order').notNull(),
  /** NULL = job chỉ một dòng. */
  label: text('label'),
  pointsNas: text('points_nas'),
  storageNas: text('storage_nas'),
  pointsCloud: text('points_cloud'),
  storageCloud: text('storage_cloud'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const isoBackupTickTable = pgTable(
  'iso_backup_tick',
  {
    lineId: uuid('line_id').notNull(),
    day: date('day').notNull(),
    result: text('result').$type<'ok' | 'fail'>().notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.lineId, t.day] })],
);

export const isoDivisionTable = pgTable('iso_division', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: citext('code'),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const isoAvClearDayTable = pgTable('iso_av_clear_day', {
  day: date('day').primaryKey(),
  markedBy: text('marked_by').notNull(),
  markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
});

export const isoAvIssueTable = pgTable('iso_av_issue', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportedOn: date('reported_on').notNull(),
  divisionId: uuid('division_id').notNull(),
  computerName: text('computer_name').notNull(),
  description: text('description').notNull(),
  resolvedOn: date('resolved_on'),
  handledBy: text('handled_by'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const isoIncidentCounterTable = pgTable('iso_incident_counter', {
  year: integer('year').primaryKey(),
  lastNo: integer('last_no').notNull(),
});

export const isoIncidentTable = pgTable('iso_incident', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: citext('code').notNull(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  reportedOn: date('reported_on').notNull(),
  kind: text('kind').notNull(),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  severity: text('severity').notNull(),
  status: text('status').notNull(),
  description: text('description').notNull(),
  correctiveAction: text('corrective_action').notNull().default(''),
  backupDetails: jsonb('backup_details').$type<BackupDetail[]>().notNull().default([]),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** Mốc sửa nội dung gần nhất: bản ký tải trước mốc này là bản cũ. */
  contentUpdatedAt: timestamp('content_updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const isoIncidentCellTable = pgTable('iso_incident_cell', {
  id: uuid('id').primaryKey().defaultRandom(),
  incidentId: uuid('incident_id').notNull(),
  tickLineId: uuid('tick_line_id'),
  tickDay: date('tick_day'),
  avIssueId: uuid('av_issue_id'),
});

export const isoPeriodTable = pgTable('iso_period', {
  id: uuid('id').primaryKey().defaultRandom(),
  formType: text('form_type').notNull(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  state: text('state').$type<'open' | 'pending' | 'locked'>().notNull().default('open'),
  snapshot: jsonb('snapshot').$type<PeriodSnapshot | null>(),
  submittedBy: text('submitted_by'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  lockedBy: text('locked_by'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const isoReminderSentTable = pgTable(
  'iso_reminder_sent',
  {
    reminderKey: text('reminder_key').notNull(),
    sentOn: date('sent_on').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.reminderKey, t.sentOn] })],
);

/** Danh sách dòng của kỳ lúc gửi chốt (AR-8): kỳ từ Chờ duyệt trở đi đọc ở đây, không đọc danh mục sống. */
export interface PeriodSnapshot {
  lines?: BackupRowSnapshot[];
  divisions?: { id: string; code: string | null; name: string }[];
}

export interface BackupRowSnapshot {
  jobId: string;
  no: number;
  name: string;
  lineId: string;
  label: string | null;
  pointsNas: string | null;
  storageNas: string | null;
  pointsCloud: string | null;
  storageCloud: string | null;
  trackedFrom: string;
  stoppedOn: string | null;
}
