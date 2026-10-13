import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage } from '@/lib/api';
import { todayIso } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
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
  parseMonthParam,
  shortDay,
  tickIndex,
  type BackupCellState,
} from './iso-rules';
import type { BackupGrid, TickResult } from './iso-types';

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

/** Ô 0203 → link "Lập 0206" điền sẵn ô đó (Story 8.3). */
export function newIncidentFor0203(lineId: string, day: string): string {
  return `${PATHS.isoIncidentNew}?cell=${encodeURIComponent(`0203:${lineId}:${day}`)}`;
}

/**
 * Lưới 0203 — Theo dõi backup (Story 8.2). Màn nhập, chỉ cần desktop (UX-DR2). Lưới là chỗ thao
 * tác duy nhất: bấm ô để đổi ✓ / ✗ / trống, lập hoặc mở 0206; nút ✓ trên đầu cột đánh hết ô
 * trống của ngày đó (Q-28).
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
                {grid.data.state === 'open' ? t('iso.reviewAndSubmit') : t('iso.viewPrint')}
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
  const toast = useToast();
  const [selected, setSelected] = useState<{ lineId: string; day: string } | null>(null);
  const days = daysOf(data.year, data.month);
  const rows = useMemo(() => groupBackupRows(data.rows), [data.rows]);
  const ticks = useMemo(() => tickIndex(data.ticks), [data.ticks]);
  const open = data.state === 'open';
  const editable = open && data.canEdit;
  const blankDays = new Set(data.summary.blankDays);

  const setTick = useIsoWrite<{ lineId: string; day: string; result: TickResult | null }>(me.csrfToken, (body) => ({
    url: '/api/v1/iso/backup/ticks',
    method: 'PUT',
    body,
  }));
  const fillDay = useIsoWrite<{ day: string }, { filled: number }>(me.csrfToken, (body) => ({
    url: '/api/v1/iso/backup/fill-day',
    method: 'POST',
    body,
  }));

  const pick = (result: TickResult | null) => {
    if (!selected) return;
    setTick.mutate(
      { ...selected, result },
      {
        onSuccess: () => setSelected(null),
        onError: (err) => toast({ message: errorMessage(err), tone: 'error' }),
      },
    );
  };

  const selectedRow = selected ? rows.find((r) => r.lineId === selected.lineId) : undefined;
  const selectedTick = selected ? ticks.get(`${selected.lineId}|${selected.day}`) : undefined;
  const missedDays = [...new Set(data.summary.missed.map((m) => m.day))];
  const rowName = (lineId: string) => {
    const row = rows.find((r) => r.lineId === lineId);
    return row ? (row.label ? `${row.name} › ${row.label}` : row.name) : '';
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
            <KpiTile value={data.summary.missed.length} tone="warn" label={t('iso.backup.missed')} />
            <KpiTile value={data.summary.unlinkedFails.length} tone="danger" label={t('iso.backup.unlinked')} />
          </KpiStrip>
          {missedDays.length > 0 ? (
            <p className="muted small">{t('iso.backup.missedDays', { days: missedDays.map(shortDay).join(', ') })}</p>
          ) : null}
          {data.summary.unlinkedFails.length > 0 ? (
            <p className="muted small">
              {t('iso.backup.unlinkedList', {
                list: data.summary.unlinkedFails.map((c) => `${rowName(c.lineId)} · ${shortDay(c.day)}`).join('; '),
              })}
            </p>
          ) : null}
        </section>
      ) : null}
      {ownerNotice}

      <section aria-labelledby="iso-backup-grid">
        <div className="sheet-toolbar">
          <h2 id="iso-backup-grid">{t('iso.grid')}</h2>
          <Legend />
        </div>
        {selected && selectedRow ? (
          <div className="sheet-picker" role="region" aria-label={t('iso.selectedCell')}>
            <div className="sheet-picker-what">
              <strong>{rowName(selected.lineId)}</strong> · {t('iso.dayOf', { day: shortDay(selected.day) })}
              <div className="muted small">{t(STATE_KEY[backupCellState(selectedRow, selected.day, selectedTick, data.today)])}</div>
            </div>
            <button type="button" className="btn sm" disabled={setTick.isPending} onClick={() => pick('ok')}>
              {t('iso.markOk')}
            </button>
            <button type="button" className="btn sm" disabled={setTick.isPending} onClick={() => pick('fail')}>
              {t('iso.markFail')}
            </button>
            <button type="button" className="btn sm ghost" disabled={setTick.isPending || !selectedTick} onClick={() => pick(null)}>
              {t('iso.markBlank')}
            </button>
            {selectedTick?.result === 'fail' ? (
              selectedTick.incident ? (
                <Link to={PATHS.isoIncident(selectedTick.incident.id)}>{t('iso.openIncident', { code: selectedTick.incident.code })}</Link>
              ) : (
                <Link to={newIncidentFor0203(selected.lineId, selected.day)}>{t('iso.createIncidentForCell')}</Link>
              )
            ) : null}
            <button type="button" className="btn sm ghost" aria-label={t('common.close')} onClick={() => setSelected(null)}>
              ×
            </button>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <p className="muted">
            {t('iso.backup.noJobs')} <Link to={PATHS.isoCatalog}>{t('iso.backup.jobsLink')}</Link>
          </p>
        ) : (
          <div className="sheet-scroll">
            <table className="sheet-grid">
              <thead>
                <tr>
                  <th scope="col" rowSpan={editable ? 2 : 1}>
                    No
                  </th>
                  <th scope="col" rowSpan={editable ? 2 : 1} className="sheet-name">
                    Name Job Backup
                  </th>
                  <th scope="col" rowSpan={editable ? 2 : 1}>
                    Points NAS
                  </th>
                  <th scope="col" rowSpan={editable ? 2 : 1}>
                    Storage location
                  </th>
                  <th scope="col" rowSpan={editable ? 2 : 1}>
                    Points Cloud
                  </th>
                  <th scope="col" rowSpan={editable ? 2 : 1}>
                    Storage location
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
                    {days.map((d) => (
                      <th key={d.day} scope="col" className="sheet-day">
                        {blankDays.has(d.day) ? (
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
                        ) : null}
                      </th>
                    ))}
                  </tr>
                ) : null}
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.lineId} className={row.first ? undefined : 'sheet-sub'}>
                    <td>{row.first ? row.no : ''}</td>
                    <td className="sheet-name" title={row.label ? `${row.name} › ${row.label}` : row.name}>
                      {row.first ? (row.label ? `${row.name} › ${row.label}` : row.name) : `↳ ${row.label ?? ''}`}
                    </td>
                    <td>{row.pointsNas}</td>
                    <td>{row.storageNas}</td>
                    <td>{row.pointsCloud}</td>
                    <td>{row.storageCloud}</td>
                    {days.map((d) => {
                      const tick = ticks.get(`${row.lineId}|${d.day}`);
                      const state = backupCellState(row, d.day, tick, data.today);
                      const clickable = editable && state !== 'off' && state !== 'future';
                      const isSelected = selected?.lineId === row.lineId && selected.day === d.day;
                      const label = t('iso.cellAria', {
                        name: row.label ? `${row.name} › ${row.label}` : row.name,
                        day: d.n,
                        state: t(STATE_KEY[state]),
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
                              aria-label={label}
                              aria-expanded={isSelected}
                              onClick={() => setSelected(isSelected ? null : { lineId: row.lineId, day: d.day })}
                            >
                              {MARK[state]}
                            </button>
                          ) : (
                            <span className="sheet-mark" data-state={state} aria-label={state === 'off' || state === 'future' ? undefined : label}>
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
        <p className="muted small">{t('iso.backup.note')}</p>
      </section>
    </>
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
    </div>
  );
}
