/**
 * Luật THUẦN của phiếu ISO đợt 1 (Q-28) — không chạm DB, ngày là chuỗi `YYYY-MM-DD` theo giờ
 * Việt Nam (nơi gọi tính "hôm nay" bằng `isoDateInTz`, không bằng giờ máy).
 */

export const ISO_FORM_TYPES = ['0203', '0208'] as const;
export type IsoFormType = (typeof ISO_FORM_TYPES)[number];

/**
 * Trạng thái LƯU của kỳ. Kỳ chưa có hàng trong DB là `open`: kỳ tự sinh cho mọi tháng (Q-28)
 * nên chỉ ghi hàng khi kỳ đổi trạng thái, không nhập tay từng kỳ.
 */
export const PERIOD_STATES = ['open', 'pending', 'locked'] as const;
export type PeriodState = (typeof PERIOD_STATES)[number];

/** Bốn tên dùng ở mọi màn: Đang ghi → Chờ duyệt → Đã chốt · chờ bản ký → Hoàn tất. */
export type PeriodDisplayState = PeriodState | 'done';

export const INCIDENT_KINDS = ['backup', 'server', 'network', 'database', 'other'] as const;
export const INCIDENT_SEVERITIES = ['low', 'medium', 'high'] as const;
export const INCIDENT_STATUSES = ['temporary_fix', 'resolved', 'in_progress'] as const;
export const BACKUP_TYPES = ['full', 'incr', 'copy'] as const;
export const BACKUP_DATA_TYPES = ['db', 'app', 'filesv'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Mẫu giấy 0206 có đúng 11 dòng "Detail Error Backup". */
export const BACKUP_DETAIL_MAX = 11;

export type TickResult = 'ok' | 'fail';

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(m[1]), month };
}

export function monthOf(day: string): { year: number; month: number } {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function dayOf(year: number, month: number, d: number): string {
  return `${year}-${pad2(month)}-${pad2(d)}`;
}

export function firstDayOf(year: number, month: number): string {
  return dayOf(year, month, 1);
}

export function lastDayOf(year: number, month: number): string {
  return dayOf(year, month, daysInMonth(year, month));
}

export function daysOfMonth(year: number, month: number): string[] {
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => dayOf(year, month, i + 1));
}

/**
 * Mở được kỳ nào: tháng tương lai thì chưa có gì để ghi; tháng trước `iso.first_month` là thời
 * phiếu giấy, IMS không giữ (Q-28: bắt đầu dùng từ 11/2026).
 */
export function periodAccess(
  year: number,
  month: number,
  today: string,
  firstMonth: string,
): 'ok' | 'future' | 'before_start' {
  const key = monthKey(year, month);
  if (key > today.slice(0, 7)) return 'future';
  const first = parseMonthKey(firstMonth);
  if (first && key < monthKey(first.year, first.month)) return 'before_start';
  return 'ok';
}

/**
 * Job áp cho ngày `day` khi nằm trong [theo dõi từ, ngày ngừng]. Ngày ngừng vẫn tính: job ngừng
 * hôm nay vẫn phải đánh hôm nay; từ ngày sau mới để trống và không là bỏ sót.
 */
export function lineApplies(trackedFrom: string, stoppedOn: string | null, day: string): boolean {
  if (day < trackedFrom) return false;
  return stoppedOn === null || day <= stoppedOn;
}

export function tickKey(lineId: string, day: string): string {
  return `${lineId}|${day}`;
}

export interface BackupLineSpan {
  id: string;
  trackedFrom: string;
  stoppedOn: string | null;
}

export interface CellRef {
  lineId: string;
  day: string;
}

export interface BackupSummary {
  todayDone: number;
  todayTotal: number;
  /** Ô trống ở ngày đã qua của kỳ (job đang áp) — "bỏ sót", đếm riêng (Q-28). */
  missed: CellRef[];
  unlinkedFails: CellRef[];
  /** Ngày (đã qua hoặc hôm nay) còn ít nhất một ô trống — nút ✓ đầu cột. */
  blankDays: string[];
}

export function backupSummary(input: {
  year: number;
  month: number;
  today: string;
  lines: BackupLineSpan[];
  ticks: Map<string, TickResult>;
  linked: Set<string>;
}): BackupSummary {
  const out: BackupSummary = { todayDone: 0, todayTotal: 0, missed: [], unlinkedFails: [], blankDays: [] };
  for (const day of daysOfMonth(input.year, input.month)) {
    if (day > input.today) break;
    let blank = false;
    for (const line of input.lines) {
      if (!lineApplies(line.trackedFrom, line.stoppedOn, day)) continue;
      const key = tickKey(line.id, day);
      const result = input.ticks.get(key);
      if (day === input.today) {
        out.todayTotal += 1;
        if (result) out.todayDone += 1;
      } else if (!result) {
        out.missed.push({ lineId: line.id, day });
      }
      if (!result) blank = true;
      if (result === 'fail' && !input.linked.has(key)) out.unlinkedFails.push({ lineId: line.id, day });
    }
    if (blank) out.blankDays.push(day);
  }
  return out;
}

export interface AntivirusSummary {
  /** Ngày đã qua hoặc hôm nay chưa tick Other Division. */
  pendingDays: string[];
  /** Phần của `pendingDays` đã qua (không tính hôm nay). */
  missedDays: string[];
  unlinkedIssues: string[];
}

export function antivirusSummary(input: {
  year: number;
  month: number;
  today: string;
  clearDays: Set<string>;
  issues: { id: string; reportedOn: string; linked: boolean }[];
}): AntivirusSummary {
  // Other Division là dòng tick tay mỗi ngày, kể cả ngày có dòng issue (Q-28, bấm từng dòng): ngày
  // chưa tick nó thì các dòng máy chưa bấm cũng còn trống.
  const pendingDays = daysOfMonth(input.year, input.month).filter((day) => day <= input.today && !input.clearDays.has(day));
  return {
    pendingDays,
    missedDays: pendingDays.filter((day) => day < input.today),
    unlinkedIssues: input.issues.filter((i) => !i.linked).map((i) => i.id),
  };
}

export interface ChecklistItem {
  key: 'month_ended' | 'no_blank' | 'fails_linked' | 'in_progress';
  ok: boolean;
  count: number;
}

/**
 * Danh sách kiểm của màn Xem lại (Q-28). Gửi chốt chỉ từ ngày cuối tháng của kỳ (Check Date trên
 * bản in là ngày cuối kỳ), và phải không còn ô trống / ô ✗ chưa có 0206. 0206 đang In Progress
 * chỉ để báo, không chặn: ô ✗ đã có phiếu là đủ.
 *
 * `missed` ở đây phải tính với "hôm nay" là NGÀY CUỐI kỳ khi đã tới ngày đó: ngày cuối còn trống
 * cũng là chưa đủ, nên nơi gọi đếm ô trống của MỌI ngày tới hết hôm nay.
 */
export function closeChecklist(input: {
  year: number;
  month: number;
  today: string;
  missed: number;
  unlinkedFails: number;
  inProgress: number;
}): { canSubmit: boolean; items: ChecklistItem[] } {
  const ended = input.today >= lastDayOf(input.year, input.month);
  const items: ChecklistItem[] = [
    { key: 'month_ended', ok: ended, count: 0 },
    { key: 'no_blank', ok: input.missed === 0, count: input.missed },
    { key: 'fails_linked', ok: input.unlinkedFails === 0, count: input.unlinkedFails },
    { key: 'in_progress', ok: true, count: input.inProgress },
  ];
  return { canSubmit: items.every((i) => i.ok), items };
}

/** Kỳ Đã chốt chỉ Hoàn tất khi có bản ký của kỳ VÀ mọi 0206 thuộc kỳ đã có bản ký (Q-28). */
export function displayState(state: PeriodState, periodSigned: boolean, incidentsSigned: boolean): PeriodDisplayState {
  if (state !== 'locked') return state;
  return periodSigned && incidentsSigned ? 'done' : 'locked';
}

/**
 * Bản ký còn hiệu lực khi tải lên SAU lần khoá gần nhất. Mở lại rồi chốt lại thì mốc khoá đổi,
 * bản cũ tự thành "cũ" mà không phải xoá hay đánh dấu — lịch sử bản ký giữ nguyên (Q-28).
 */
export function signedIsCurrent(uploadedAt: Date, since: Date | null): boolean {
  return since !== null && uploadedAt.getTime() >= since.getTime();
}

/**
 * Kỳ nào (của tháng phiếu) quản một phiếu 0206: loại phiếu của các ô ✗ đã gắn trong tháng đó. Phiếu
 * cuối tháng chỉ có ô của tháng sau vẫn là sự cố của loại phiếu đó, nên lấy loại của các ô ấy —
 * không coi là lập thẳng. Phiếu không gắn ô nào thuộc mọi kỳ của tháng: nó nằm trong hồ sơ ISO
 * của cả tháng.
 */
export function incidentGoverning(cells: { form: IsoFormType; day: string }[], year: number, month: number): IsoFormType[] {
  const own = cells.filter((c) => c.day.startsWith(`${monthKey(year, month)}-`));
  const set = new Set((own.length > 0 ? own : cells).map((c) => c.form));
  return set.size === 0 ? [...ISO_FORM_TYPES] : ISO_FORM_TYPES.filter((f) => set.has(f));
}

/**
 * Phiếu khoá khi mọi kỳ quản nó đã duyệt chốt. In Progress vẫn sửa được sau khi kỳ khoá và tự
 * khoá ngay khi đổi sang Resolved / Temporary Fix (Q-28) — không cần bước khoá riêng.
 */
export function incidentLocked(status: IncidentStatus, governingStates: PeriodState[]): boolean {
  if (status === 'in_progress') return false;
  return governingStates.length > 0 && governingStates.every((s) => s === 'locked');
}

/**
 * Phiếu chưa khoá nhưng có kỳ quản nó đang Chờ duyệt: chỉ xem, như ô lưới của kỳ đó — SA không
 * được duyệt một bản vừa bị đổi. Cần sửa thì "Trả lại" kỳ. In Progress vẫn sửa được (Q-28).
 */
export function incidentInReview(status: IncidentStatus, governingStates: PeriodState[]): boolean {
  if (status === 'in_progress') return false;
  return governingStates.some((s) => s === 'pending');
}

export function incidentCode(year: number, n: number): string {
  return `0206-${year}-${String(n).padStart(3, '0')}`;
}

export interface BackupDetail {
  jobName: string;
  typeBackup: (typeof BACKUP_TYPES)[number] | null;
  typeData: (typeof BACKUP_DATA_TYPES)[number] | null;
  storage: string;
  errorMessage: string;
  resolution: string;
}

export interface IncidentInput {
  reportedOn: string;
  kind: IncidentKind;
  /** ISO 8601 có múi giờ. */
  detectedAt: string;
  resolvedAt: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  description: string;
  correctiveAction: string;
  backupDetails: BackupDetail[];
}

export interface FieldError {
  field: keyof IncidentInput;
  message: string;
}

/** Luật nội dung của form 0206 — câu lỗi tiếng Việt đi thẳng ra màn. */
export function validateIncident(input: IncidentInput): FieldError[] {
  const errors: FieldError[] = [];
  const add = (field: keyof IncidentInput, message: string) => errors.push({ field, message });
  if (!(INCIDENT_KINDS as readonly string[]).includes(input.kind)) add('kind', 'Chọn Type of Incident.');
  if (!(INCIDENT_SEVERITIES as readonly string[]).includes(input.severity)) add('severity', 'Chọn Severity Level.');
  if (!(INCIDENT_STATUSES as readonly string[]).includes(input.status)) add('status', 'Chọn Current Status.');
  const detected = Date.parse(input.detectedAt);
  if (Number.isNaN(detected)) add('detectedAt', 'Detection Time không hợp lệ.');
  if (input.status === 'in_progress') {
    if (input.resolvedAt) add('resolvedAt', 'Sự cố In Progress chưa có Resolution Time — để trống ô này.');
  } else if (!input.resolvedAt) {
    add('resolvedAt', 'Nhập Resolution Time, hoặc chọn In Progress nếu chưa xử lý xong.');
  } else {
    const resolved = Date.parse(input.resolvedAt);
    if (Number.isNaN(resolved)) add('resolvedAt', 'Resolution Time không hợp lệ.');
    else if (!Number.isNaN(detected) && resolved < detected) add('resolvedAt', 'Resolution Time phải sau Detection Time.');
  }
  if (!input.description.trim()) add('description', 'Ghi Incident Description.');
  if (input.status !== 'in_progress' && !input.correctiveAction.trim()) add('correctiveAction', 'Ghi Corrective Action.');
  if (input.kind === 'backup') {
    if (input.backupDetails.length > BACKUP_DETAIL_MAX) {
      add('backupDetails', `Detail Error Backup tối đa ${BACKUP_DETAIL_MAX} dòng như mẫu giấy.`);
    } else if (input.backupDetails.some((d) => !d.jobName.trim())) {
      add('backupDetails', 'Mỗi dòng Detail Error Backup phải có Job Name.');
    }
  } else if (input.backupDetails.length > 0) {
    add('backupDetails', 'Chỉ loại Backup mới có bảng Detail Error Backup.');
  }
  return errors;
}
