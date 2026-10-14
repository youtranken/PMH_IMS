import { describe, expect, it } from 'vitest';
import {
  avIssueMark,
  avOtherMark,
  avResultDays,
  backupCellState,
  daysOf,
  fromVnParts,
  groupBackupRows,
  groupByDivision,
  lineStorage,
  nextTick,
  parseMonthParam,
  pointsError,
  shiftMonth,
  toVnParts,
} from './iso-rules';
import type { AvIssue, BackupRow } from './iso-types';

const row = (jobId: string, lineId: string): BackupRow => ({
  jobId,
  no: 1,
  name: jobId,
  lineId,
  label: null,
  pointsNas: null,
  storageNas: null,
  pointsCloud: null,
  storageCloud: null,
  trackedFrom: '2026-11-03',
  stoppedOn: '2026-11-20',
});

describe('iso-rules (web)', () => {
  it.each([
    ['2026-11', { year: 2026, month: 11 }],
    ['2026-13', { year: 2026, month: 12 }],
    [null, { year: 2026, month: 12 }],
  ])('parseMonthParam(%s)', (raw, out) => {
    expect(parseMonthParam(raw, '2026-12-05')).toEqual(out);
  });

  it.each([
    [2026, 12, 1, { year: 2027, month: 1 }],
    [2026, 1, -1, { year: 2025, month: 12 }],
  ])('shiftMonth(%i, %i, %i)', (y, m, d, out) => {
    expect(shiftMonth(y, m, d)).toEqual(out);
  });

  it('daysOf ghi thứ, Chủ Nhật là cuối tuần', () => {
    const days = daysOf(2026, 11);
    expect(days).toHaveLength(30);
    expect(days[0]).toEqual({ day: '2026-11-01', n: 1, weekday: 'CN', weekend: true });
    expect(days[1].weekday).toBe('T2');
  });

  it.each([
    ['2026-11-02', undefined, 'off'],
    ['2026-11-21', undefined, 'off'],
    ['2026-11-12', undefined, 'future'],
    ['2026-11-04', undefined, 'missed'],
    ['2026-11-10', undefined, 'blank'],
    ['2026-11-04', { result: 'ok' as const, incident: null }, 'ok'],
    ['2026-11-04', { result: 'fail' as const, incident: null }, 'fail'],
    ['2026-11-04', { result: 'fail' as const, incident: { id: 'i', code: '0206-2026-001' } }, 'fail-linked'],
  ])('ô ngày %s · %o → %s', (day, tick, out) => {
    expect(backupCellState(row('j', 'l'), day, tick ? { lineId: 'l', day, ...tick } : undefined, '2026-11-10')).toBe(out);
  });

  it('gộp dòng theo job', () => {
    const grouped = groupBackupRows([row('a', '1'), row('a', '2'), row('b', '3')]);
    expect(grouped.map((r) => [r.first, r.span])).toEqual([
      [true, 2],
      [false, 2],
      [true, 1],
    ]);
  });

  it('job có đối tượng con thì tách cột tên job / đối tượng con như mẫu giấy; job một dòng thì không', () => {
    const grouped = groupBackupRows([{ ...row('a', '1'), label: 'OS' }, { ...row('a', '2'), label: 'Volume_E' }, row('b', '3')]);
    expect(grouped.map((r) => r.split)).toEqual([true, true, false]);
  });

  it.each([
    ['', ''],
    ['14', ''],
    [' 7 ', ''],
    ['9999', ''],
    ['c', 'bad'],
    ['1.5', 'bad'],
    ['-1', 'bad'],
    ['10000', 'bad'],
  ])('pointsError(%s)', (input, out) => {
    expect(pointsError(input)).toBe(out);
  });

  it('Storage location theo Points: có số điểm lưu thì NAS / Cloud, bỏ trống thì trống như mẫu', () => {
    expect(lineStorage('14', 'NAS')).toBe('NAS');
    expect(lineStorage(' ', 'Cloud')).toBeNull();
    expect(lineStorage('7', 'Cloud')).toBe('Cloud');
  });

  it('bấm ô 0203 đi vòng trống → ✓ → ✗ → trống', () => {
    expect(nextTick(null)).toBe('ok');
    expect(nextTick('ok')).toBe('fail');
    expect(nextTick('fail')).toBeNull();
  });

  it('0208: ✗ đúng ngày phát hiện, ✓ ngày đã có kết quả, Other Division ✓ ngày có kết quả', () => {
    const days = avResultDays(['2026-11-01'], [{ reportedOn: '2026-11-02' }]);
    const issue = { reportedOn: '2026-11-02' };
    expect(avIssueMark(issue, '2026-11-02', days)).toBe('✗');
    expect(avIssueMark(issue, '2026-11-01', days)).toBe('✓');
    expect(avIssueMark(issue, '2026-11-03', days)).toBe('');
    expect(avOtherMark('2026-11-02', days)).toBe('✓');
    expect(avOtherMark('2026-11-03', days)).toBe('');
  });

  it('gom issue theo bộ phận, chỉ bộ phận có issue', () => {
    const issue = (id: string, divisionId: string, divisionName: string, reportedOn: string): AvIssue => ({
      id,
      divisionId,
      divisionName,
      reportedOn,
      computerName: id,
      description: '',
      resolvedOn: null,
      handledBy: null,
      incident: null,
    });
    const groups = groupByDivision([issue('b', 'd2', 'SMD', '2026-11-05'), issue('a', 'd1', 'D&E', '2026-11-04'), issue('c', 'd2', 'SMD', '2026-11-01')]);
    expect(groups.map((g) => [g.divisionName, g.issues.map((i) => i.id)])).toEqual([
      ['D&E', ['a']],
      ['SMD', ['c', 'b']],
    ]);
  });

  it('giờ Việt Nam ↔ ISO, không theo giờ máy', () => {
    expect(toVnParts('2026-11-04T18:30:00.000Z')).toEqual({ date: '2026-11-05', time: '01:30' });
    expect(fromVnParts('2026-11-05', '01:30')).toBe('2026-11-04T18:30:00.000Z');
    expect(fromVnParts('2026-11-05', '')).toBeNull();
  });
});
