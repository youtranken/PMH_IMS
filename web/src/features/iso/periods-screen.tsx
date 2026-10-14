import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage } from '@/lib/api';
import { formatDateTime, todayIso } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { useConfirm } from '@/ui/confirm-provider';
import { KpiStrip, KpiTile } from '@/ui/kpi-strip';
import { LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { SegmentedRadio } from '@/ui/segmented-radio';
import { useToast } from '@/ui/toast';
import { ISO_KEY, useIsoWrite, usePeriodDetail, useYearOverview } from './iso-api';
import { PeriodStateBadge, PeriodSteps } from './iso-parts';
import { monthKey, monthLabel, pad2 } from './iso-rules';
import { ReasonDialog } from '@/ui/reason-dialog';
import { ISO_FORM_TYPES, type IsoFormType, type MonthOverview, type PeriodDetail } from './iso-types';

const FORM_NAME: Record<IsoFormType, string> = { '0203': '0203 · Backup', '0208': '0208 · Antivirus' };

/**
 * Kỳ phiếu & chốt kỳ — màn ĐỌC, chạy ở 390px. Năm → bảng 12 tháng (mới nhất trên
 * cùng), mỗi loại phiếu một cột; bấm một tháng thì hiện chi tiết kỳ với đúng nút theo vai. Phiếu
 * giữ vĩnh viễn (FR-031).
 */
export function PeriodsScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => todayIso());
  const thisYear = Number(today.slice(0, 4));
  const monthParam = params.get('month');
  const picked = monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : null;
  const year = Number(params.get('year')) || (picked ? Number(picked.slice(0, 4)) : thisYear);
  const overview = useYearOverview(year);
  // Chưa chọn tháng thì mở sẵn tháng mới nhất đã tới — khung chi tiết không bỏ trống nửa màn.
  const latest = overview.data?.months.filter((m) => m.access !== 'before_start' && m.access !== 'future').at(-1);
  const selected = picked ?? (latest ? monthKey(year, latest.month) : null);
  const manager = me.role === 'sa' || me.role === 'admin';

  const select = (key: string | null) => {
    const next = new URLSearchParams(params);
    if (key) next.set('month', key);
    else next.delete('month');
    next.delete('form');
    setParams(next, { replace: true });
  };

  const kpis = overview.data?.kpis ?? {};
  return (
    <>
      <PageHeader
        title={t('nav.isoPeriods')}
        subtitle={t('iso.periods.subtitle')}
        actions={
          <SegmentedRadio
            label={t('iso.incidents.year')}
            value={String(year)}
            options={[...new Set([year, thisYear - 1, thisYear])].sort().map((y) => ({ value: String(y), label: String(y) }))}
            onChange={(v) => setParams({ year: v }, { replace: true })}
          />
        }
      />
      {overview.data ? (
        <KpiStrip>
          {manager ? (
            <>
              <KpiTile value={kpis.pending ?? 0} tone="warn" label={t('iso.periods.kpiPending')} />
              <KpiTile value={kpis.reopenPending ?? 0} tone="warn" label={t('iso.periods.kpiReopen')} />
              <KpiTile value={kpis.awaitingSigned ?? 0} label={t('iso.periods.kpiSigned')} />
              <KpiTile value={kpis.done ?? 0} label={t('iso.periods.kpiDone')} />
            </>
          ) : (
            <>
              <KpiTile value={kpis.unlinkedFails ?? 0} tone="danger" label={t('iso.periods.kpiUnlinked')} to={PATHS.isoIncidents} />
              <KpiTile value={kpis.awaitingSigned ?? 0} tone="warn" label={t('iso.periods.kpiSigned')} />
              <KpiTile value={kpis.pending ?? 0} label={t('iso.periods.kpiPending')} />
              <KpiTile value={kpis.done ?? 0} label={t('iso.periods.kpiDone')} />
            </>
          )}
        </KpiStrip>
      ) : null}
      {overview.isLoading ? (
        <Loading variant="table" />
      ) : overview.isError ? (
        <LoadError error={overview.error} onRetry={() => void overview.refetch()} />
      ) : overview.data ? (
        <div className="sheet-split">
          <YearTable year={year} months={overview.data.months} selected={selected} onSelect={select} />
          {selected ? <MonthDetail key={selected} me={me} month={selected} /> : <p className="muted">{t('iso.periods.pickMonth')}</p>}
        </div>
      ) : null}
    </>
  );
}

function YearTable({
  year,
  months,
  selected,
  onSelect,
}: {
  year: number;
  months: MonthOverview[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const { t } = useTranslation();
  // Tháng chưa tới không có gì để xem hay làm — ẩn, không vẽ thành hàng "—" mờ.
  const usable = months.filter((m) => m.access !== 'before_start' && m.access !== 'future');
  if (usable.length === 0) return <p className="alert info">{t('iso.periods.paperYear', { year })}</p>;
  return (
    <section aria-labelledby="iso-year">
      <h2 id="iso-year">{t('iso.periods.yearTitle', { year })}</h2>
      <div className="table-wrap">
        <table className="table table-stack">
          <thead>
            <tr>
              <th>{t('iso.periods.month')}</th>
              {ISO_FORM_TYPES.map((f) => (
                <th key={f}>{FORM_NAME[f]}</th>
              ))}
              <th>{t('iso.periods.incidentsCol')}</th>
            </tr>
          </thead>
          <tbody>
            {usable.map((m) => {
              const key = monthKey(year, m.month);
              return (
                <tr key={m.month} aria-selected={selected === key}>
                  <td data-label={t('iso.periods.month')}>
                    <button type="button" className={`btn sm${selected === key ? ' primary' : ''}`} aria-pressed={selected === key} onClick={() => onSelect(key)}>
                      {t('iso.periods.monthN', { month: pad2(m.month) })}
                    </button>
                  </td>
                  {m.forms.map((f) => (
                    <td key={f.formType} data-label={FORM_NAME[f.formType]}>
                      <PeriodStateBadge state={f.display} />
                    </td>
                  ))}
                  <td data-label="0206">{t('iso.periods.incidentCount', { count: m.incidents, signed: m.incidentsSigned })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MonthDetail({ me, month }: { me: Me; month: string }) {
  const { t } = useTranslation();
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const d0203 = usePeriodDetail('0203', month);
  const d0208 = usePeriodDetail('0208', month);
  const all = [d0203, d0208];
  const incidents = [...(d0203.data?.incidents ?? []), ...(d0208.data?.incidents ?? [])].filter(
    (inc, i, list) => list.findIndex((x) => x.id === inc.id) === i,
  );
  return (
    <aside aria-labelledby="iso-month">
      <h2 id="iso-month">{t('iso.periods.detailTitle', { month: monthLabel(year, mon) })}</h2>
      {all.some((q) => q.isLoading) ? <Loading /> : null}
      {all.map((q) => (q.isError ? <LoadError key={String(q.error)} error={q.error} onRetry={() => void q.refetch()} /> : null))}
      {d0203.data ? <FormCard me={me} month={month} detail={d0203.data} /> : null}
      {d0208.data ? <FormCard me={me} month={month} detail={d0208.data} /> : null}
      <article className="card">
        <h3>{t('iso.periods.incidentsCol')}</h3>
        {incidents.length === 0 ? (
          <p className="muted small">{t('iso.periods.noIncidents')}</p>
        ) : (
          <ul className="sheet-checks">
            {incidents.map((inc) => (
              <li key={inc.id}>
                <span className="sheet-check-icon" aria-hidden="true">
                  {inc.signedCurrent ? '✓' : '•'}
                </span>
                <span>
                  <Link className="mono" to={PATHS.isoIncident(inc.id)}>
                    {inc.code}
                  </Link>{' '}
                  {inc.signedCurrent ? t('iso.incidents.signedYes') : inc.locked ? t('iso.incidents.signedNo') : t('iso.incidents.notLocked')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </article>
    </aside>
  );
}

function FormCard({ me, month, detail }: { me: Me; month: string; detail: PeriodDetail }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<'return' | 'reopen' | 'deny' | null>(null);
  const base = `/api/v1/iso/periods/${detail.formType}/${month}`;
  const write = useIsoWrite<{ path: string; body?: unknown }, PeriodDetail>(me.csrfToken, ({ path, body }) => ({
    url: `${base}${path}`,
    method: 'POST',
    body: body ?? {},
  }));
  const run = (path: string, body: unknown, done: string) =>
    write.mutate(
      { path, body },
      {
        onSuccess: () => {
          setDialog(null);
          toast({ message: t(done) });
        },
        onError: (err) => toast({ message: errorMessage(err), tone: 'error' }),
      },
    );
  const review = PATHS.isoReview(detail.formType, month);
  const locked = detail.state === 'locked';

  return (
    <article className="card" aria-label={FORM_NAME[detail.formType]}>
      <h3>
        {FORM_NAME[detail.formType]} <PeriodStateBadge state={detail.display} />
      </h3>
      <PeriodSteps state={detail.display} />
      {detail.state === 'open' ? (
        <p className="muted small">
          {detail.lastReturn?.note ? t('iso.review.returned', { note: detail.lastReturn.note, by: detail.lastReturn.by ?? '' }) : t('iso.periods.openNote')}
        </p>
      ) : detail.state === 'pending' ? (
        <p className="muted small">{t('iso.periods.pendingNote', { name: detail.pendingClose?.requesterName ?? '', at: formatDateTime(detail.submittedAt) })}</p>
      ) : (
        <p className="muted small">{t('iso.periods.lockedNote', { name: detail.lockedBy ?? '', at: formatDateTime(detail.lockedAt) })}</p>
      )}
      <div className="chip-row">
        {detail.state === 'open' && detail.canWrite ? (
          <Link className="linkbtn primary sm" to={review}>
            {t('iso.viewForm')}
          </Link>
        ) : null}
        {detail.state === 'pending' && detail.canDecide ? (
          <>
            <Link className="linkbtn primary sm" to={review}>
              {t('iso.periods.reviewApprove')}
            </Link>
            <button type="button" className="btn sm danger-ghost" onClick={() => setDialog('return')}>
              {t('iso.review.return')}
            </button>
          </>
        ) : null}
        {detail.state === 'pending' && !detail.canDecide ? <span className="muted small">{t('iso.review.waiting')}</span> : null}
        {locked ? (
          <Link className="linkbtn sm" to={review}>
            {t('iso.viewForm')}
          </Link>
        ) : null}
        {locked && detail.canWrite && !detail.pendingReopen ? (
          <button type="button" className="btn sm ghost" onClick={() => setDialog('reopen')}>
            {t('iso.periods.reopen')}
          </button>
        ) : null}
      </div>
      {detail.pendingReopen ? (
        <div className="alert warn">
          <p>{t('iso.periods.reopenPending', { name: detail.pendingReopen.requesterName, reason: detail.pendingReopen.reason })}</p>
          {detail.canDecide ? (
            <div className="chip-row">
              <button
                type="button"
                className="btn sm primary"
                disabled={write.isPending}
                onClick={() =>
                  void askConfirm({
                    title: t('common.titleOf', { action: t('iso.periods.reopenApprove'), subject: `${detail.formType} · ${monthLabel(detail.year, detail.month)}` }),
                    message: t('iso.periods.reopenApproveConfirm'),
                    confirmLabel: t('iso.periods.reopenApprove'),
                  }).then((ok) => {
                    if (ok) run('/reopen/approve', {}, 'iso.periods.reopened');
                  })
                }
              >
                {t('iso.periods.reopenApprove')}
              </button>
              <button type="button" className="btn sm danger-ghost" onClick={() => setDialog('deny')}>
                {t('iso.periods.reopenDeny')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {locked && detail.periodId ? (
        <details open={!detail.signedCurrent}>
          <summary>{detail.signedCurrent ? t('iso.signedHas') : detail.canWrite ? t('iso.periods.uploadSigned') : t('iso.signedMissing')}</summary>
          {detail.canWrite ? <p className="muted small">{t('iso.periods.signedHint')}</p> : null}
          <AttachmentPanel
            ownerType="iso_period"
            ownerId={detail.periodId}
            csrfToken={me.csrfToken}
            canEdit={detail.canWrite}
            accept=".pdf,.jpg,.jpeg,.png"
            staleBefore={detail.lockedAt}
            onChanged={() => void queryClient.invalidateQueries({ queryKey: ISO_KEY })}
          />
        </details>
      ) : null}
      {dialog === 'return' ? (
        <ReasonDialog
          title={t('iso.review.returnTitle')}
          label={t('iso.review.returnReason')}
          confirmLabel={t('iso.review.return')}
          busy={write.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(reason) => run('/return', { reason }, 'iso.review.returnedToast')}
        />
      ) : null}
      {dialog === 'reopen' ? (
        <ReasonDialog
          title={t('iso.periods.reopenTitle', { form: detail.formType, month: monthLabel(detail.year, detail.month) })}
          label={t('iso.periods.reopenReason')}
          hint={t('iso.periods.reopenHint')}
          confirmLabel={t('iso.periods.reopenSend')}
          busy={write.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(reason) => run('/reopen', { reason }, 'iso.periods.reopenSent')}
        />
      ) : null}
      {dialog === 'deny' ? (
        <ReasonDialog
          title={t('iso.periods.reopenDeny')}
          label={t('iso.periods.denyReason')}
          confirmLabel={t('iso.periods.reopenDeny')}
          busy={write.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(reason) => run('/reopen/deny', { reason }, 'iso.periods.reopenDenied')}
        />
      ) : null}
    </article>
  );
}
