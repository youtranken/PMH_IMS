/**
 * Hình dạng dữ liệu của API phiếu ISO (`api/src/modules/iso-forms`, Q-28) — bản đọc của web.
 * Ngày là `YYYY-MM-DD` theo giờ Việt Nam, tháng là `YYYY-MM`.
 */

export type IsoFormType = '0203' | '0208';
export const ISO_FORM_TYPES: IsoFormType[] = ['0203', '0208'];

export type PeriodState = 'open' | 'pending' | 'locked';
export type PeriodDisplayState = PeriodState | 'done';
export type TickResult = 'ok' | 'fail';

export interface BackupRow {
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

export interface CellRef {
  lineId: string;
  day: string;
}

export interface TickCell extends CellRef {
  result: TickResult;
  incident: { id: string; code: string } | null;
}

export interface BackupGrid {
  formType: '0203';
  year: number;
  month: number;
  today: string;
  state: PeriodState;
  periodId: string | null;
  canEdit: boolean;
  systemName: string;
  rows: BackupRow[];
  ticks: TickCell[];
  summary: {
    todayDone: number;
    todayTotal: number;
    missed: CellRef[];
    unlinkedFails: CellRef[];
    blankDays: string[];
  };
}

export interface AvIssue {
  id: string;
  reportedOn: string;
  divisionId: string;
  divisionName: string;
  computerName: string;
  description: string;
  resolvedOn: string | null;
  handledBy: string | null;
  incident: { id: string; code: string } | null;
}

export interface AntivirusGrid {
  formType: '0208';
  year: number;
  month: number;
  today: string;
  state: PeriodState;
  periodId: string | null;
  canEdit: boolean;
  systemName: string;
  issues: AvIssue[];
  clearDays: string[];
  summary: { pendingDays: string[]; missedDays: string[]; unlinkedIssues: string[] };
}

export interface Division {
  id: string;
  code: string | null;
  name: string;
  active: boolean;
}

export interface JobLine {
  id: string;
  label: string | null;
  pointsNas: string | null;
  storageNas: string | null;
  pointsCloud: string | null;
  storageCloud: string | null;
}

export interface Job {
  id: string;
  no: number;
  name: string;
  trackedFrom: string;
  stoppedOn: string | null;
  lines: JobLine[];
}

export interface IsoPerson {
  id: string;
  email: string;
  fullName: string;
}

export interface FormOwners {
  formType: IsoFormType;
  primary: IsoPerson | null;
  backup: IsoPerson | null;
}

export const INCIDENT_KINDS = ['backup', 'server', 'network', 'database', 'other'] as const;
export const INCIDENT_SEVERITIES = ['low', 'medium', 'high'] as const;
export const INCIDENT_STATUSES = ['temporary_fix', 'resolved', 'in_progress'] as const;
export const BACKUP_TYPES = ['full', 'incr', 'copy'] as const;
export const BACKUP_DATA_TYPES = ['db', 'app', 'filesv'] as const;
export const BACKUP_DETAIL_MAX = 11;

export type IncidentKind = (typeof INCIDENT_KINDS)[number];
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export interface BackupDetail {
  jobName: string;
  typeBackup: (typeof BACKUP_TYPES)[number] | null;
  typeData: (typeof BACKUP_DATA_TYPES)[number] | null;
  storage: string;
  errorMessage: string;
  resolution: string;
}

export interface IncidentCell {
  form: IsoFormType;
  lineId: string | null;
  day: string;
  issueId: string | null;
  label: string;
}

export interface UnlinkedCell extends IncidentCell {
  year: number;
  month: number;
}

export interface SignedFile {
  id: string;
  originalName: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
  current: boolean;
}

export interface IncidentContent {
  reportedOn: string;
  kind: IncidentKind;
  detectedAt: string;
  resolvedAt: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  description: string;
  correctiveAction: string;
  backupDetails: BackupDetail[];
}

export interface Incident extends IncidentContent {
  id: string;
  code: string;
  year: number;
  month: number;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  contentUpdatedAt: string;
  cells: IncidentCell[];
  governing: IsoFormType[];
  locked: boolean;
  /** Kỳ quản phiếu đang Chờ duyệt: chỉ xem. */
  inReview: boolean;
  signedCurrent: boolean;
  signed: SignedFile[];
  /** Chỉ có ở API chi tiết một phiếu. */
  canWrite?: boolean;
}

export interface ChecklistItem {
  key: 'month_ended' | 'no_blank' | 'fails_linked' | 'in_progress';
  ok: boolean;
  count: number;
}

export interface PendingApproval {
  id: string;
  kind: string;
  requester: string;
  requesterName: string;
  reason: string;
  createdAt: string;
}

export interface PeriodDetail {
  formType: IsoFormType;
  year: number;
  month: number;
  today: string;
  periodId: string | null;
  state: PeriodState;
  display: PeriodDisplayState;
  canWrite: boolean;
  canDecide: boolean;
  submittedBy: string | null;
  submittedAt: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  checklist: { canSubmit: boolean; items: ChecklistItem[] } | null;
  pendingClose: PendingApproval | null;
  pendingReopen: PendingApproval | null;
  lastReturn: { note: string | null; by: string | null; at: string | null } | null;
  signed: SignedFile[];
  signedCurrent: boolean;
  incidents: { id: string; code: string; status: IncidentStatus; locked: boolean; signedCurrent: boolean }[];
  counts: { rows: number };
}

export interface MonthOverview {
  month: number;
  access: 'ok' | 'future' | 'before_start';
  forms: { formType: IsoFormType; state: PeriodState; display: PeriodDisplayState; periodId: string | null }[];
  incidents: number;
  incidentsSigned: number;
}

export interface YearOverview {
  year: number;
  months: MonthOverview[];
  kpis: Record<string, number>;
}

export interface IsoTodo {
  count: number;
  pendingApprovals: number;
  unlinkedFails: number;
  awaitingSigned: number;
}

/** Nhãn i18n của bốn trạng thái kỳ — một bộ tên ở mọi màn (Q-28). */
export const PERIOD_STATE_KEY: Record<PeriodDisplayState, string> = {
  open: 'iso.state.open',
  pending: 'iso.state.pending',
  locked: 'iso.state.locked',
  done: 'iso.state.done',
};

export const PERIOD_STATE_TONE: Record<PeriodDisplayState, string> = {
  open: 'info',
  pending: 'warn',
  locked: 'muted',
  done: 'ok',
};

export const INCIDENT_STATUS_TONE: Record<IncidentStatus, string> = {
  resolved: 'ok',
  temporary_fix: 'info',
  in_progress: 'warn',
};
