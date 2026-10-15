import type { AvIssue, AvMark, BackupRow, TickCell, TickResult } from './iso-types';

/**
 * Luật THUẦN phía web của phiếu ISO (Q-28). Server là trọng tài cho mọi lượt ghi; ở đây chỉ dựng
 * lưới và chữ cho đúng cái server sẽ nhận.
 */

const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

/** `?month=` lạ thì về tháng của hôm nay — không gửi chữ lạ lên API. */
export function parseMonthParam(raw: string | null, today: string): { year: number; month: number } {
  const m = raw ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw) : null;
  if (m) return { year: Number(m[1]), month: Number(m[2]) };
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthLabel(year: number, month: number): string {
  return `${pad2(month)}/${year}`;
}

export interface MonthDay {
  day: string;
  n: number;
  weekday: string;
  weekend: boolean;
}

export function daysOf(year: number, month: number): MonthDay[] {
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const dow = new Date(Date.UTC(year, month - 1, n)).getUTCDay();
    return { day: `${year}-${pad2(month)}-${pad2(n)}`, n, weekday: WEEKDAY[dow], weekend: dow === 0 };
  });
}

export function lastDayOfMonth(year: number, month: number): string {
  return `${year}-${pad2(month)}-${pad2(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

/** `2026-11-05` → `05/11`. */
export function shortDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

export function lineApplies(trackedFrom: string, stoppedOn: string | null, day: string): boolean {
  if (day < trackedFrom) return false;
  return stoppedOn === null || day <= stoppedOn;
}

export type BackupCellState = 'off' | 'future' | 'ok' | 'fail' | 'fail-linked' | 'missed' | 'blank';

/** Một ô của lưới 0203: ngoài thời gian theo dõi / tương lai / ✓ / ✗ (có / chưa có 0206) / bỏ sót / trống. */
export function backupCellState(row: Pick<BackupRow, 'trackedFrom' | 'stoppedOn'>, day: string, tick: TickCell | undefined, today: string): BackupCellState {
  if (!lineApplies(row.trackedFrom, row.stoppedOn, day)) return 'off';
  if (day > today) return 'future';
  if (tick?.result === 'ok') return 'ok';
  if (tick?.result === 'fail') return tick.incident ? 'fail-linked' : 'fail';
  return day < today ? 'missed' : 'blank';
}

export interface GroupedRow extends BackupRow {
  /** Dòng đầu của job: in No + tên job, các dòng sau chỉ in đối tượng con. */
  first: boolean;
  /** Số dòng của job (gộp ô No trên bản in). */
  span: number;
  /**
   * Job có đối tượng con: tên job một cột (gộp dọc), đối tượng con cột bên cạnh — đúng mẫu
   * SP-IT0203. Job một dòng thì tên trải qua cả hai cột.
   */
  split: boolean;
}

export function groupBackupRows(rows: BackupRow[]): GroupedRow[] {
  const spans = new Map<string, number>();
  const split = new Set<string>();
  for (const row of rows) {
    spans.set(row.jobId, (spans.get(row.jobId) ?? 0) + 1);
    if (row.label) split.add(row.jobId);
  }
  return rows.map((row, i) => ({
    ...row,
    first: i === 0 || rows[i - 1].jobId !== row.jobId,
    span: spans.get(row.jobId) ?? 1,
    split: split.has(row.jobId),
  }));
}

/** Points NAS / Cloud là số bản giữ lại — khớp `POINTS_RE` của API. Trống là hợp lệ. */
export function pointsError(points: string): '' | 'bad' {
  const text = points.trim();
  return text === '' || /^\d{1,4}$/.test(text) ? '' : 'bad';
}

/** Storage location in theo Points: có số điểm lưu thì ghi nơi lưu, không có thì để trống như mẫu. */
export function lineStorage(points: string, place: 'NAS' | 'Cloud'): string | null {
  return points.trim() ? place : null;
}

/**
 * Một lần bấm ô 0203: trống → ✓ → ✗ → trống. Luồng chuẩn (Q-28) là ✓ cả ngày rồi sửa ô lỗi
 * thành ✗, nên ô ✓ chỉ cần một lần bấm để thành ✗; bấm nhầm thì bấm tiếp là về trống.
 */
export function nextTick(current: TickResult | null): TickResult | null {
  if (current === null) return 'ok';
  return current === 'ok' ? 'fail' : null;
}

export function tickIndex(ticks: TickCell[]): Map<string, TickCell> {
  return new Map(ticks.map((t) => [`${t.lineId}|${t.day}`, t]));
}

export interface AvMarkIndex {
  clear: ReadonlySet<string>;
  marks: ReadonlyMap<string, TickResult>;
}

export function avMarkIndex(clearDays: string[], marks: AvMark[]): AvMarkIndex {
  return { clear: new Set(clearDays), marks: new Map(marks.map((m) => [`${m.issueId}|${m.day}`, m.result])) };
}

/** Dấu bấm tay của một ô dòng máy; `null` = chưa bấm. */
export function avMarkOf(issue: Pick<AvIssue, 'id'>, day: string, index: AvMarkIndex): TickResult | null {
  return index.marks.get(`${issue.id}|${day}`) ?? null;
}

/**
 * Ô của một dòng máy (Q-28, bấm từng dòng): ngày phát hiện luôn ✗; ô đã bấm theo dấu bấm; ô chưa
 * bấm ✓ khi Other Division ngày đó đã ✓ (máy đó không có issue mới), còn lại để trống.
 */
export function avIssueMark(issue: Pick<AvIssue, 'id' | 'reportedOn'>, day: string, index: AvMarkIndex): '' | '✓' | '✗' {
  if (day === issue.reportedOn) return '✗';
  const mark = avMarkOf(issue, day, index);
  if (mark) return mark === 'ok' ? '✓' : '✗';
  return index.clear.has(day) ? '✓' : '';
}

/** Dòng "Other Division": tick tay từng ngày. */
export function avOtherMark(day: string, index: AvMarkIndex): '' | '✓' {
  return index.clear.has(day) ? '✓' : '';
}

export interface DivisionGroup {
  divisionId: string;
  divisionName: string;
  issues: AvIssue[];
}

/** Gom issue theo bộ phận — chỉ bộ phận có issue trong tháng mới có nhóm (cột Division đổi theo tháng). */
export function groupByDivision(issues: AvIssue[]): DivisionGroup[] {
  const groups = new Map<string, DivisionGroup>();
  for (const issue of issues) {
    const group = groups.get(issue.divisionId) ?? { divisionId: issue.divisionId, divisionName: issue.divisionName, issues: [] };
    group.issues.push(issue);
    groups.set(issue.divisionId, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.divisionName.localeCompare(b.divisionName, 'vi'))
    .map((g) => ({ ...g, issues: [...g.issues].sort((a, b) => a.reportedOn.localeCompare(b.reportedOn) || a.computerName.localeCompare(b.computerName)) }));
}

/** Giờ ứng dụng là Asia/Ho_Chi_Minh, không đổi giờ mùa hè: lệch cố định +07:00. */
const VN_OFFSET_MS = 7 * 3_600_000;

/** Mốc ISO → `{ date: 'YYYY-MM-DD', time: 'HH:mm' }` theo giờ Việt Nam (ô nhập không theo giờ máy). */
export function toVnParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const at = new Date(Date.parse(iso) + VN_OFFSET_MS).toISOString();
  return { date: at.slice(0, 10), time: at.slice(11, 16) };
}

/** Ngày + giờ Việt Nam → mốc ISO UTC. Thiếu một nửa thì `null`. */
export function fromVnParts(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const at = Date.parse(`${date}T${time}:00.000Z`) - VN_OFFSET_MS;
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/** `dd/mm/yyyy HH:mm` theo giờ Việt Nam. */
export function vnDateTime(iso: string | null): string {
  if (!iso) return '';
  const { date, time } = toVnParts(iso);
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)} ${time}`;
}
