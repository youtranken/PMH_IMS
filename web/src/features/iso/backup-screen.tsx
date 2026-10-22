import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage } from '@/lib/api';
import { todayIso } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { BREAKPOINTS } from '@/ui/breakpoints';
import { useMediaQuery } from '@/ui/use-media-query';
import { KpiStrip, KpiTile } from '@/ui/kpi-strip';
import { LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { useToast } from '@/ui/toast';
import { useBackupGrid, useIsoWrite, useOwners } from './iso-api';
import { LockedBanner, MonthNav, OwnerNotice, PeriodStateBadge } from './iso-parts';
import {
  backupCellState,
  daysOf,
  groupBackupRows,
  monthKey,
  nextTick,
  parseMonthParam,
  shortDay,
  tickIndex,
  type BackupCellState,
} from './iso-rules';
import { IncidentDialogHost, type IncidentDialogTarget } from './incident-dialog';
import { useTickQueue } from './use-tick-queue';
import type { BackupGrid, IncidentCell, TickCell, TickResult } from './iso-types';
import { InfoTip } from '@/ui/info-tip';

/** Khoá viết thẳng (không ghép chuỗi) để bài "khoá dịch chết" đọc được. */
const STATE_KEY: Record<BackupCellState, string> = {
  off: 'iso.cellState.off',
  future: 'iso.cellState.future',
  ok: 'iso.cellState.ok',
  fail: 'iso.cellState.fail',
  'fail-linked': 'iso.cellState.fail-linked',
  missed: 'iso.cellState.missed',
  blank: 'iso.cellState.blank',
};

const MARK: Record<BackupCellState, string> = {
  off: '',
  future: '',
  ok: '✓',
  fail: '✗',
  'fail-linked': '✗',
  missed: '',
  blank: '',
};

/**
 * Lưới 0203 — Theo dõi backup. Màn nhập, chỉ cần desktop (UX-DR2). Bấm ô đi vòng trống → ✓ →
 * ✗ → trống (phím 1/V, 2/X, Delete đặt thẳng; mũi tên đi giữa các ô); nút ✓ trên đầu cột đánh hết
 * ô trống của ngày đó (Q-28). Lập / mở 0206 bằng hộp ngay trên lưới, không rời màn.
 */
export function BackupScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => todayIso());
  const { year, month } = parseMonthParam(params.get('month'), today);
  const key = monthKey(year, month);
  const grid = useBackupGrid(key);
  const owners = useOwners();

  return (
    <>
      <PageHeader
        title={t('nav.isoBackup')}
        subtitle={t('iso.backup.subtitle')}
        actions={
          <>
            <Link className="linkbtn" to={PATHS.isoCatalog}>
              {t('iso.backup.jobsLink')}
            </Link>
            {grid.data ? (
              <Link className={`linkbtn${grid.data.state === 'open' ? ' primary' : ''}`} to={PATHS.isoReview('0203', key)}>
                {t('iso.viewForm')}
              </Link>
            ) : null}
          </>
        }
      />
      <div className="sheet-toolbar">
        <MonthNav
          year={year}
          month={month}
          today={grid.data?.today ?? today}
          onChange={(next) => setParams({ month: monthKey(next.year, next.month) }, { replace: true })}
        />
        {grid.data ? <PeriodStateBadge state={grid.data.state} /> : null}
      </div>
      {grid.isLoading ? (
        <Loading />
      ) : grid.isError ? (
        <LoadError error={grid.error} onRetry={() => void grid.refetch()} />
      ) : grid.data ? (
        <BackupBody
          me={me}
          data={grid.data}
          ownerNotice={
            grid.data.state === 'open' && !grid.data.canEdit ? (
              <OwnerNotice form="0203" owners={owners.data?.find((o) => o.formType === '0203')} />
            ) : null
          }
        />
      ) : null}
    </>
  );
}

function BackupBody({ me, data, ownerNotice }: { me: Me; data: BackupGrid; ownerNotice: React.ReactNode }) {
  const { t } = useTranslation();
  const phone = useMediaQuery(BREAKPOINTS.cards);
  const toast = useToast();
  const [dialog, setDialog] = useState<IncidentDialogTarget | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const days = daysOf(data.year, data.month);
  const rows = useMemo(() => groupBackupRows(data.rows), [data.rows]);
  const ticks = useMemo(() => tickIndex(data.ticks), [data.ticks]);
  const open = data.state === 'open';
  const editable = open && data.canEdit;
  const blankDays = new Set(data.summary.blankDays);
  const rowName = (lineId: string) => {
    const row = rows.find((r) => r.lineId === lineId);
    return row ? (row.label ? `${row.name} › ${row.label}` : row.name) : '';
  };
  const cellOf = (lineId: string, day: string): IncidentCell => ({ form: '0203', lineId, day, issueId: null, label: rowName(lineId) });

  const queue = useTickQueue(me.csrfToken, '0203', monthKey(data.year, data.month), {
    onSaved: (lineId, day, result) => {
      if (result !== 'fail') return;
      toast({
        message: t('iso.backup.markedFail', { name: rowName(lineId), day: shortDay(day) }),
        action: { label: t('iso.backup.createIncident'), onClick: () => setDialog({ cell: cellOf(lineId, day) }) },
      });
    },
    onError: (err) => toast({ message: errorMessage(err), tone: 'error' }),
  });
  const fillDay = useIsoWrite<{ day: string }, { filled: number }>(me.csrfToken, (body) => ({
    url: '/api/v1/iso/backup/fill-day',
    method: 'POST',
    body,
  }));

  // Mở lưới là thấy cột hôm nay: cuối tháng cột đó nằm ngoài khung, phải tự cuộn mới đánh được.
  useEffect(() => {
    const box = scrollRef.current;
    const cell = box?.querySelector<HTMLElement>('th[data-today]');
    if (box && cell) box.scrollLeft = Math.max(0, cell.offsetLeft - box.clientWidth / 2);
  }, []);

  /** Kết quả đang hiện của ô: giá trị vừa bấm (chưa kịp lưu) thắng giá trị server. */
  const effective = (lineId: string, day: string): TickCell | undefined => {
    const key = `${lineId}|${day}`;
    const tick = ticks.get(key);
    if (!queue.pending.has(key)) return tick;
    const value = queue.pending.get(key) ?? null;
    return value === null ? undefined : { lineId, day, result: value, incident: tick?.incident ?? null };
  };

  const press = (lineId: string, day: string, wanted?: TickResult | null) => {
    const tick = effective(lineId, day);
    // Ô ✗ đã gắn phiếu: API cấm đổi kết quả, nên bấm là mở phiếu chứ không thử đổi rồi báo lỗi.
    if (tick?.incident) {
      setDialog({ incidentId: tick.incident.id });
      return;
    }
    const next = wanted === undefined ? nextTick(tick?.result ?? null) : wanted;
    if (next === (tick?.result ?? null)) return;
    queue.set(lineId, day, next);
  };

  const onCellKey = (event: React.KeyboardEvent<HTMLButtonElement>, lineId: string, day: string, state: BackupCellState) => {
    const key = event.key.toLowerCase();
    const move = { arrowleft: [0, -1], arrowright: [0, 1], arrowup: [-1, 0], arrowdown: [1, 0] }[key];
    if (move) {
      event.preventDefault();
      const r = Number(event.currentTarget.dataset.row) + move[0];
      const c = Number(event.currentTarget.dataset.col) + move[1];
      scrollRef.current?.querySelector<HTMLButtonElement>(`button[data-row="${r}"][data-col="${c}"]`)?.focus();
      return;
    }
    const wanted = key === '1' || key === 'v' ? 'ok' : key === '2' || key === 'x' ? 'fail' : key === 'delete' || key === 'backspace' ? null : undefined;
    if (wanted !== undefined) {
      event.preventDefault();
      press(lineId, day, wanted);
      return;
    }
    if (key === 'enter' && state === 'fail') {
      event.preventDefault();
      setDialog({ cell: cellOf(lineId, day) });
    }
  };


  return (
    <>
      {!open ? <LockedBanner form="0203" year={data.year} month={data.month} state={data.state} /> : null}
      {open ? (
        <section aria-label={t('iso.todoSection')}>
          <KpiStrip>
            {/* Ô "hôm nay" chỉ có nghĩa ở kỳ của tháng hiện tại; tháng đã qua chỉ còn bỏ sót và ✗. */}
            {data.today.slice(0, 7) === monthKey(data.year, data.month) ? (
              <KpiTile value={data.summary.todayDone} label={t('iso.backup.todayDone', { total: data.summary.todayTotal, day: shortDay(data.today) })} />
            ) : null}
            {/* Bấm ô số là tới ô bỏ sót đầu tiên trên lưới (PW-B17) — thay dòng liệt kê ngày nói
                lại đúng con số này. */}
            <KpiTile
              value={data.summary.missed.length}
              tone="warn"
              label={t('iso.backup.missed')}
              onClick={
                data.summary.missed.length > 0
                  ? () => scrollRef.current?.querySelector<HTMLButtonElement>('button.sheet-mark[data-state="missed"]')?.focus()
                  : undefined
              }
            />
            <KpiTile value={data.summary.unlinkedFails.length} tone="danger" label={t('iso.backup.unlinked')} />
          </KpiStrip>
          {editable && data.summary.unlinkedFails.length > 0 ? (
            <ul className="sheet-checks" aria-label={t('iso.backup.unlinked')}>
              {data.summary.unlinkedFails.map((c) => (
                <li key={`${c.lineId}|${c.day}`} data-bad="">
                  <span className="sheet-check-icon" aria-hidden="true">
                    ✗
                  </span>
                  <span>
                    {rowName(c.lineId)} · {shortDay(c.day)}{' '}
                    <button type="button" className="btn sm" onClick={() => setDialog({ cell: cellOf(c.lineId, c.day) })}>
                      {t('iso.backup.createIncident')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {ownerNotice}

      <section aria-labelledby="iso-backup-grid">
        <div className="sheet-toolbar">
          {/* Cách đánh ô + ghi chú phiếu vào (i) (TX-14): hai đoạn 200+ ký tự luôn hiện chiếm 5–6
              dòng ở 390px trước khi tới lưới. */}
          <div className="page-header-title">
            <h2 id="iso-backup-grid">{t('iso.grid')}</h2>
            <InfoTip subject={t('iso.grid')}>
              {editable ? <p>{t('iso.backup.howTo')}</p> : null}
              <p>{t('iso.backup.note')}</p>
            </InfoTip>
          </div>
          <Legend />
        </div>
        {rows.length === 0 ? (
          <p className="muted">
            {t('iso.backup.noJobs')} <Link to={PATHS.isoCatalog}>{t('iso.backup.jobsLink')}</Link>
          </p>
        ) : phone ? (
          /* Điện thoại: cột cố định chiếm hết bề ngang, không còn ô ngày nào để bấm (PW-B18). */
          <p className="alert info">{t('iso.gridDesktopOnly')}</p>
        ) : (
          <div
            className="sheet-scroll"
            ref={scrollRef}
            // Lưới rộng hơn màn: vùng cuộn phải vào được bằng bàn phím (AX-07).
            tabIndex={0}
            role="region"
            aria-label={t('iso.field.tab0203')}
          >
            <table className="sheet-grid sheet-grid-0203" style={{ '--sheet-days': days.length } as React.CSSProperties}>
              <colgroup>
                <col className="sheet-col-no" />
                <col className="sheet-col-job" />
                <col className="sheet-col-sub" />
                {days.map((d) => (
                  <col key={d.day} className="sheet-col-day" />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" rowSpan={editable ? 2 : 1} className="sheet-no">
                    {t('iso.field.no')}
                  </th>
                  <th scope="col" rowSpan={editable ? 2 : 1} colSpan={2} className="sheet-name">
                    {t('iso.field.jobName')}
                  </th>
                  {days.map((d) => (
                    <th
                      key={d.day}
                      scope="col"
                      className="sheet-day"
                      data-today={d.day === data.today ? '' : undefined}
                      data-weekend={d.weekend ? '' : undefined}
                    >
                      {d.n}
                      <small>{d.weekday}</small>
                    </th>
                  ))}
                </tr>
                {editable ? (
                  <tr>
                    {days.map((d) =>
                      // Ngày không còn ô trống thì không có nút: ô tiêu đề rỗng là lỗi trợ năng (AX-09).
                      !blankDays.has(d.day) ? (
                        <td key={d.day} className="sheet-day" />
                      ) : (
                        <th key={d.day} scope="col" className="sheet-day">
                          <button
                            type="button"
                            className="sheet-fill"
                            aria-label={t('iso.backup.fillDay', { day: shortDay(d.day) })}
                            title={t('iso.backup.fillDay', { day: shortDay(d.day) })}
                            disabled={fillDay.isPending}
                            onClick={() =>
                              fillDay.mutate(
                                { day: d.day },
                                {
                                  onSuccess: (r) => toast({ message: t('iso.backup.filled', { count: r.filled, day: shortDay(d.day) }) }),
                                  onError: (err) => toast({ message: errorMessage(err), tone: 'error' }),
                                },
                              )
                            }
                          >
                            ✓
                          </button>
                        </th>
                      ),
                    )}
                  </tr>
                ) : null}
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={row.lineId}>
                    {row.first ? (
                      <td rowSpan={row.span} className="sheet-no">
                        {row.no}
                      </td>
                    ) : null}
                    {/* Như mẫu SP-IT0203: tên job gộp dọc một cột, đối tượng con cột bên cạnh.
                        Points / Storage location ít đổi nên chỉ có trên bản in, không chiếm chỗ lưới. */}
                    {!row.split ? (
                      <td colSpan={2} className="sheet-name" title={row.name}>
                        {row.name}
                      </td>
                    ) : (
                      <>
                        {row.first ? (
                          <td rowSpan={row.span} className="sheet-name" title={row.name}>
                            {row.name}
                          </td>
                        ) : null}
                        <td className="sheet-label" title={row.label ?? ''}>
                          {row.label}
                        </td>
                      </>
                    )}
                    {days.map((d, c) => {
                      const tick = effective(row.lineId, d.day);
                      const state = backupCellState(row, d.day, tick, data.today);
                      const clickable = editable && state !== 'off' && state !== 'future';
                      const name = row.label ? `${row.name} › ${row.label}` : row.name;
                      const label = t('iso.cellAria', {
                        name,
                        day: d.n,
                        state: tick?.incident ? t('iso.cellState.linkedTo', { code: tick.incident.code }) : t(STATE_KEY[state]),
                      });
                      return (
                        <td
                          key={d.day}
                          className="sheet-cell"
                          data-off={state === 'off' ? '' : undefined}
                          data-future={state === 'future' ? '' : undefined}
                          data-today={d.day === data.today ? '' : undefined}
                        >
                          {clickable ? (
                            <button
                              type="button"
                              className="sheet-mark"
                              data-state={state}
                              data-row={r}
                              data-col={c}
                              aria-label={label}
                              title={label}
                              onClick={() => press(row.lineId, d.day)}
                              onKeyDown={(e) => onCellKey(e, row.lineId, d.day, state)}
                            >
                              {MARK[state]}
                            </button>
                          ) : state === 'fail-linked' && tick?.incident ? (
                            <IncidentMark label={label} onOpen={() => setDialog({ incidentId: tick.incident?.id ?? '' })} />
                          ) : (
                            <span
                              className="sheet-mark"
                              data-state={state}
                              // aria-label trên span trần không có tác dụng (axe aria-prohibited-attr): cần role (AX-08).
                              role={state === 'off' || state === 'future' ? undefined : 'img'}
                              aria-label={state === 'off' || state === 'future' ? undefined : label}
                            >
                              {MARK[state]}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <IncidentDialogHost me={me} target={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

/** Ô ✗ đã gắn 0206 ở lưới chỉ xem (kỳ khoá / không phụ trách): bấm vẫn mở được phiếu để đọc. */
function IncidentMark({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button type="button" className="sheet-mark" data-state="fail-linked" aria-label={label} title={label} onClick={onOpen}>
      ✗
    </button>
  );
}

function Legend() {
  const { t } = useTranslation();
  return (
    <div className="sheet-legend">
      <span>
        <span className="sheet-mark" data-state="ok">
          ✓
        </span>
        {t('iso.legend.ok')}
      </span>
      <span>
        <span className="sheet-mark" data-state="fail">
          ✗
        </span>
        {t('iso.legend.fail')}
      </span>
      <span>
        <span className="sheet-mark" data-state="fail-linked">
          ✗
        </span>
        {t('iso.legend.failLinked')}
      </span>
      <span>
        <span className="sheet-mark" data-state="missed" />
        {t('iso.legend.missed')}
      </span>
      <span>
        <span className="sheet-swatch" data-off="" />
        {t('iso.legend.off')}
      </span>
      <span>
        <span className="sheet-swatch" data-future="" />
        {t('iso.legend.future')}
      </span>
    </div>
  );
}
