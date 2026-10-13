import {
  antivirusSummary,
  backupSummary,
  closeChecklist,
  displayState,
  incidentCode,
  incidentGoverning,
  incidentLocked,
  lastDayOf,
  lineApplies,
  monthOf,
  parseMonthKey,
  periodAccess,
  signedIsCurrent,
  validateIncident,
  type IncidentInput,
} from './iso-rules';

describe('iso-rules · tháng và ngày', () => {
  it.each([
    [2026, 2, '2026-02-28'],
    [2028, 2, '2028-02-29'],
    [2026, 10, '2026-10-31'],
    [2026, 11, '2026-11-30'],
  ])('ngày cuối %i/%i là %s', (year, month, last) => {
    expect(lastDayOf(year, month)).toBe(last);
  });

  it.each([
    ['2026-11', { year: 2026, month: 11 }],
    ['2026-1', null],
    ['2026-13', null],
    ['abc', null],
  ])('parseMonthKey(%s)', (key, out) => {
    expect(parseMonthKey(key)).toEqual(out);
  });

  it('monthOf lấy năm/tháng của chuỗi ngày', () => {
    expect(monthOf('2026-10-05')).toEqual({ year: 2026, month: 10 });
  });

  it.each([
    // [năm, tháng, hôm nay, tháng bắt đầu, kết quả]
    [2026, 11, '2026-11-03', '2026-11', 'ok'],
    [2026, 10, '2026-11-03', '2026-11', 'before_start'],
    [2026, 12, '2026-11-30', '2026-11', 'future'],
    [2027, 1, '2027-03-01', '2026-11', 'ok'],
  ])('periodAccess %i/%i hôm nay %s từ %s → %s', (year, month, today, first, out) => {
    expect(periodAccess(year, month, today, first)).toBe(out);
  });
});

describe('iso-rules · job áp cho ngày nào', () => {
  it.each([
    ['2026-10-15', null, '2026-10-14', false],
    ['2026-10-15', null, '2026-10-15', true],
    ['2026-10-01', '2026-10-20', '2026-10-20', true],
    ['2026-10-01', '2026-10-20', '2026-10-21', false],
  ])('theo dõi từ %s ngừng %s · ngày %s → %s', (from, stopped, day, out) => {
    expect(lineApplies(from, stopped, day)).toBe(out);
  });
});

describe('iso-rules · tóm tắt lưới 0203', () => {
  const lines = [
    { id: 'a', trackedFrom: '2026-11-01', stoppedOn: null },
    { id: 'b', trackedFrom: '2026-11-03', stoppedOn: null },
  ];

  it('đếm ô hôm nay, ô bỏ sót ngày đã qua và ô ✗ chưa có phiếu', () => {
    const ticks = new Map<string, 'ok' | 'fail'>([
      ['a|2026-11-01', 'ok'],
      ['a|2026-11-02', 'fail'],
      ['a|2026-11-03', 'ok'],
      ['b|2026-11-03', 'fail'],
      ['a|2026-11-04', 'ok'],
    ]);
    const s = backupSummary({ year: 2026, month: 11, today: '2026-11-04', lines, ticks, linked: new Set(['b|2026-11-03']) });
    expect(s.todayDone).toBe(1);
    expect(s.todayTotal).toBe(2);
    // b chỉ theo dõi từ ngày 3, nên ngày 1–2 của b không phải bỏ sót.
    expect(s.missed).toEqual([]);
    expect(s.unlinkedFails).toEqual([{ lineId: 'a', day: '2026-11-02' }]);
    expect(s.blankDays).toEqual(['2026-11-04']);
  });

  it('kỳ đã qua: cả ngày cuối cũng là bỏ sót', () => {
    const s = backupSummary({
      year: 2026,
      month: 11,
      today: '2026-12-02',
      lines: [{ id: 'a', trackedFrom: '2026-11-29', stoppedOn: null }],
      ticks: new Map([['a|2026-11-29', 'ok']]),
      linked: new Set(),
    });
    expect(s.todayTotal).toBe(0);
    expect(s.missed).toEqual([
      { lineId: 'a', day: '2026-11-30' },
    ]);
  });

  it('job ngừng giữa tháng: ngày sau ngày ngừng không tính bỏ sót', () => {
    const s = backupSummary({
      year: 2026,
      month: 11,
      today: '2026-11-05',
      lines: [{ id: 'a', trackedFrom: '2026-10-01', stoppedOn: '2026-11-02' }],
      ticks: new Map([
        ['a|2026-11-01', 'ok'],
        ['a|2026-11-02', 'ok'],
      ]),
      linked: new Set(),
    });
    expect(s.missed).toEqual([]);
    expect(s.todayTotal).toBe(0);
  });
});

describe('iso-rules · tóm tắt 0208', () => {
  it('ngày chưa có kết quả, ngày bỏ sót và issue chưa có phiếu', () => {
    const s = antivirusSummary({
      year: 2026,
      month: 11,
      today: '2026-11-04',
      clearDays: new Set(['2026-11-01']),
      issues: [
        { id: 'i1', reportedOn: '2026-11-02', linked: true },
        { id: 'i2', reportedOn: '2026-11-04', linked: false },
      ],
    });
    expect(s.pendingDays).toEqual(['2026-11-03']);
    expect(s.missedDays).toEqual(['2026-11-03']);
    expect(s.unlinkedIssues).toEqual(['i2']);
  });

  it('hôm nay chưa có kết quả thì chờ nhưng chưa là bỏ sót', () => {
    const s = antivirusSummary({ year: 2026, month: 11, today: '2026-11-01', clearDays: new Set(), issues: [] });
    expect(s.pendingDays).toEqual(['2026-11-01']);
    expect(s.missedDays).toEqual([]);
  });
});

describe('iso-rules · danh sách kiểm trước khi gửi chốt', () => {
  it('chưa tới ngày cuối tháng thì không gửi được', () => {
    const c = closeChecklist({ year: 2026, month: 11, today: '2026-11-29', missed: 0, unlinkedFails: 0, inProgress: 0 });
    expect(c.canSubmit).toBe(false);
    expect(c.items.find((i) => i.key === 'month_ended')?.ok).toBe(false);
  });

  it('đủ ngày, không bỏ sót, mọi ✗ có phiếu → gửi được; In Progress không chặn', () => {
    const c = closeChecklist({ year: 2026, month: 11, today: '2026-11-30', missed: 0, unlinkedFails: 0, inProgress: 2 });
    expect(c.canSubmit).toBe(true);
    expect(c.items.find((i) => i.key === 'in_progress')).toEqual(expect.objectContaining({ ok: true, count: 2 }));
  });

  it.each([
    [{ missed: 1, unlinkedFails: 0 }, 'no_blank'],
    [{ missed: 0, unlinkedFails: 3 }, 'fails_linked'],
  ])('%o chặn ở mục %s', (bad, key) => {
    const c = closeChecklist({ year: 2026, month: 11, today: '2026-12-01', inProgress: 0, ...bad });
    expect(c.canSubmit).toBe(false);
    expect(c.items.find((i) => i.key === key)?.ok).toBe(false);
  });
});

describe('iso-rules · trạng thái kỳ và khoá phiếu sự cố', () => {
  it.each([
    ['open', true, true, 'open'],
    ['pending', true, true, 'pending'],
    ['locked', false, true, 'locked'],
    ['locked', true, false, 'locked'],
    ['locked', true, true, 'done'],
  ] as const)('%s · bản ký kỳ %s · 0206 đủ bản ký %s → %s', (state, signed, incidentsSigned, out) => {
    expect(displayState(state, signed, incidentsSigned)).toBe(out);
  });

  it('bản ký hiện hành phải tải lên sau lần khoá gần nhất', () => {
    const locked = new Date('2026-12-01T03:00:00Z');
    expect(signedIsCurrent(new Date('2026-12-01T03:00:01Z'), locked)).toBe(true);
    expect(signedIsCurrent(new Date('2026-11-30T03:00:00Z'), locked)).toBe(false);
    expect(signedIsCurrent(new Date('2026-12-01T03:00:01Z'), null)).toBe(false);
  });

  it.each([
    [[], ['0203', '0208']],
    [['0208'], ['0208']],
    [['0203', '0208', '0203'], ['0203', '0208']],
  ])('phiếu có ô của %o thuộc kỳ %o', (forms, out) => {
    expect(incidentGoverning(forms as ('0203' | '0208')[])).toEqual(out);
  });

  it.each([
    ['resolved', ['locked'], true],
    ['temporary_fix', ['locked', 'locked'], true],
    ['resolved', ['locked', 'pending'], false],
    ['in_progress', ['locked'], false],
    ['resolved', ['open'], false],
  ] as const)('%s với kỳ %o → khoá %s', (status, states, out) => {
    expect(incidentLocked(status, [...states])).toBe(out);
  });

  it.each([
    [2026, 1, '0206-2026-001'],
    [2027, 42, '0206-2027-042'],
    [2027, 1234, '0206-2027-1234'],
  ])('số phiếu năm %i thứ %i là %s', (year, n, code) => {
    expect(incidentCode(year, n)).toBe(code);
  });
});

describe('iso-rules · kiểm form 0206', () => {
  const base: IncidentInput = {
    reportedOn: '2026-11-05',
    kind: 'server',
    detectedAt: '2026-11-05T01:00:00.000Z',
    resolvedAt: '2026-11-05T03:00:00.000Z',
    severity: 'medium',
    status: 'resolved',
    description: 'Máy chủ mất kết nối',
    correctiveAction: 'Khởi động lại',
    backupDetails: [],
  };

  it('form đúng thì không có lỗi', () => {
    expect(validateIncident(base)).toEqual([]);
  });

  it.each([
    [{ status: 'resolved' as const, resolvedAt: null }, 'resolvedAt'],
    [{ status: 'in_progress' as const, resolvedAt: '2026-11-05T03:00:00.000Z' }, 'resolvedAt'],
    [{ resolvedAt: '2026-11-04T03:00:00.000Z' }, 'resolvedAt'],
    [{ description: '  ' }, 'description'],
    [{ correctiveAction: '' }, 'correctiveAction'],
    [{ kind: 'printer' as never }, 'kind'],
    [{ backupDetails: [{ jobName: 'X', typeBackup: null, typeData: null, storage: '', errorMessage: '', resolution: '' }] }, 'backupDetails'],
  ])('%o báo lỗi ở %s', (patch, field) => {
    expect(validateIncident({ ...base, ...patch }).map((e) => e.field)).toContain(field);
  });

  it('In Progress để trống Resolution Time và Corrective Action được', () => {
    expect(validateIncident({ ...base, status: 'in_progress', resolvedAt: null, correctiveAction: '' })).toEqual([]);
  });

  it('Backup: tối đa 11 dòng, mỗi dòng phải có Job Name', () => {
    const row = { jobName: 'SPM_DB', typeBackup: 'incr' as const, typeData: 'db' as const, storage: 'NAS', errorMessage: 'VSS', resolution: 'Chạy lại' };
    expect(validateIncident({ ...base, kind: 'backup', backupDetails: [row] })).toEqual([]);
    expect(validateIncident({ ...base, kind: 'backup', backupDetails: Array(12).fill(row) }).map((e) => e.field)).toContain('backupDetails');
    expect(validateIncident({ ...base, kind: 'backup', backupDetails: [{ ...row, jobName: ' ' }] }).map((e) => e.field)).toContain('backupDetails');
  });
});
