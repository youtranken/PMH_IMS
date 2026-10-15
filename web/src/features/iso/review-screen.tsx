import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '@/lib/api';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { useConfirm } from '@/ui/confirm-provider';
import { LoadError, Loading, NotFound } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Tabs } from '@/ui/tabs';
import { useToast } from '@/ui/toast';
import { useAntivirusGrid, useBackupGrid, useIsoWrite, usePeriodDetail } from './iso-api';
import { PeriodStateBadge, PeriodSteps } from './iso-parts';
import { AntivirusPaper, BackupPaper } from './iso-paper';
import { ReasonDialog } from '@/ui/reason-dialog';
import { lastDayOfMonth, monthLabel, shortDay } from './iso-rules';
import type { ChecklistItem, IsoFormType, PeriodDetail } from './iso-types';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * "Xem phiếu": đúng bản in sẽ ký, cùng danh sách kiểm và nút gửi chốt phiếu của tháng. Còn mục
 * chưa đạt thì nút gửi khoá (API cũng từ chối). SA/Admin duyệt / trả lại ngay tại đây; kỳ đã khoá
 * thì chỉ còn xem và in.
 */
export function ReviewScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { form, month } = useParams();
  const m = month ? MONTH_RE.exec(month) : null;
  if ((form !== '0203' && form !== '0208') || !m || !month) return <NotFound />;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  return (
    <>
      <div className="no-print">
        <PageHeader
          title={t('iso.review.title', { form, month: monthLabel(year, mon) })}
          subtitle={t('iso.review.subtitle')}
          actions={
            <>
              <Link to={PATHS.isoPeriod(form, month)}>{t('iso.review.backToPeriods')}</Link>
              <button type="button" className="btn" onClick={() => window.print()}>
                {t('iso.print')}
              </button>
            </>
          }
        />
        <Tabs
          ariaLabel={t('iso.review.forms')}
          value={form}
          items={[
            { key: '0203', label: '0203 · Backup' },
            { key: '0208', label: '0208 · Antivirus' },
          ]}
          onChange={(key) => navigate(PATHS.isoReview(key, month), { replace: true })}
        />
      </div>
      <ReviewBody key={`${form}-${month}`} me={me} form={form} month={month} year={year} mon={mon} />
    </>
  );
}

function ReviewBody({ me, form, month, year, mon }: { me: Me; form: IsoFormType; month: string; year: number; mon: number }) {
  const detail = usePeriodDetail(form, month);
  const backup = useBackupGrid(month, form === '0203');
  const antivirus = useAntivirusGrid(month, form === '0208');
  const grid = form === '0203' ? backup : antivirus;
  if (detail.isLoading || grid.isLoading) return <Loading />;
  if (detail.isError) return <LoadError error={detail.error} onRetry={() => void detail.refetch()} />;
  if (grid.isError) return <LoadError error={grid.error} onRetry={() => void grid.refetch()} />;
  return (
    <div className="sheet-review">
      {detail.data ? <ReviewAside me={me} detail={detail.data} month={month} /> : null}
      {form === '0203' && backup.data ? (
        <BackupPaper year={year} month={mon} systemName={backup.data.systemName} rows={backup.data.rows} ticks={backup.data.ticks} />
      ) : antivirus.data ? (
        <AntivirusPaper year={year} month={mon} systemName={antivirus.data.systemName} issues={antivirus.data.issues} clearDays={antivirus.data.clearDays} marks={antivirus.data.marks} />
      ) : null}
    </div>
  );
}

function checkText(t: (key: string, opts?: Record<string, unknown>) => string, item: ChecklistItem, detail: PeriodDetail): string {
  const last = shortDay(lastDayOfMonth(detail.year, detail.month));
  switch (item.key) {
    case 'month_ended':
      return item.ok ? t('iso.check.endedOk', { day: last }) : t('iso.check.endedBad', { day: last });
    case 'no_blank':
      return item.ok ? t('iso.check.noBlankOk') : t(detail.formType === '0203' ? 'iso.check.blankCells' : 'iso.check.blankDays', { count: item.count });
    case 'fails_linked':
      return item.ok ? t('iso.check.linkedOk') : t('iso.check.linkedBad', { count: item.count });
    case 'in_progress':
      return t('iso.check.inProgress', { count: item.count });
  }
}

function ReviewAside({ me, detail, month }: { me: Me; detail: PeriodDetail; month: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const [returning, setReturning] = useState(false);
  const base = `/api/v1/iso/periods/${detail.formType}/${month}`;
  const submit = useIsoWrite<void, PeriodDetail>(me.csrfToken, () => ({ url: `${base}/submit`, method: 'POST' }));
  const approve = useIsoWrite<void, PeriodDetail>(me.csrfToken, () => ({ url: `${base}/approve`, method: 'POST', body: {} }));
  const back = useIsoWrite<{ reason: string }, PeriodDetail>(me.csrfToken, (body) => ({ url: `${base}/return`, method: 'POST', body }));
  const gridPath = detail.formType === '0203' ? PATHS.isoBackupAt(month) : PATHS.isoAntivirusAt(month);
  const fail = (err: unknown) => toast({ message: errorMessage(err), tone: 'error' });
  const self = detail.pendingClose?.requester.toLowerCase() === me.email.toLowerCase();
  const submitLabel = t('iso.review.submit', { month: monthLabel(detail.year, detail.month) });

  return (
    <aside className="no-print">
      <section className="card" aria-labelledby="iso-review-state">
        <h2 id="iso-review-state">
          {t('iso.review.stateTitle')} <PeriodStateBadge state={detail.display} />
        </h2>
        <PeriodSteps state={detail.display} />
        {detail.lastReturn?.note ? (
          <p className="alert warn">{t('iso.review.returned', { note: detail.lastReturn.note, by: detail.lastReturn.by ?? '' })}</p>
        ) : null}
      </section>
      {detail.checklist ? (
        <section className="card" aria-labelledby="iso-review-checks">
          <h2 id="iso-review-checks">{t('iso.review.checksTitle')}</h2>
          <ul className="sheet-checks">
            {detail.checklist.items.map((item) => (
              <li key={item.key} data-bad={item.ok ? undefined : ''}>
                <span className="sheet-check-icon" aria-hidden="true">
                  {item.key === 'in_progress' ? 'i' : item.ok ? '✓' : '✗'}
                </span>
                <span>
                  {checkText(t, item, detail)}
                  {!item.ok && item.key === 'no_blank' ? (
                    <>
                      {' '}
                      <Link to={gridPath}>{t('iso.review.fixGrid')}</Link>
                    </>
                  ) : null}
                  {!item.ok && item.key === 'fails_linked' ? (
                    <>
                      {' '}
                      <Link to={PATHS.isoIncidents}>{t('iso.review.fixIncidents')}</Link>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
            <li>
              <span className="sheet-check-icon" aria-hidden="true">
                i
              </span>
              <span>{t(detail.formType === '0203' ? 'iso.review.jobCount' : 'iso.review.divisionCount', { count: detail.counts.rows })}</span>
            </li>
          </ul>
          {detail.canWrite ? (
            <div className="chip-row">
              <button
                type="button"
                className="btn primary"
                disabled={!detail.checklist.canSubmit || submit.isPending}
                onClick={() =>
                  void askConfirm({
                    title: `${submitLabel} · ${detail.formType}`,
                    message: t('iso.review.submitConfirm'),
                    confirmLabel: submitLabel,
                  }).then((ok) => {
                    if (ok) submit.mutate(undefined, { onSuccess: () => toast({ message: t('iso.review.submitted') }), onError: fail });
                  })
                }
              >
                {submitLabel}
              </button>
              <Link to={gridPath}>{t('iso.review.backToGrid')}</Link>
            </div>
          ) : (
            <p className="muted small">{t('iso.review.cannotSubmit')}</p>
          )}
        </section>
      ) : null}
      {detail.state === 'pending' && detail.pendingClose ? (
        <section className="card" aria-labelledby="iso-review-decide">
          <h2 id="iso-review-decide">{t('iso.review.decideTitle')}</h2>
          <p className="muted small">
            {t('iso.review.sentBy', { name: detail.pendingClose.requesterName })}
            {self ? ` · ${t('iso.review.selfNote')}` : ''}
          </p>
          {detail.canDecide ? (
            <div className="chip-row">
              <button
                type="button"
                className="btn primary"
                disabled={approve.isPending}
                onClick={() =>
                  void askConfirm({
                    title: t('common.titleOf', { action: t('iso.review.approve'), subject: `${detail.formType} · ${monthLabel(detail.year, detail.month)}` }),
                    message: t('iso.review.approveConfirm'),
                    confirmLabel: t('iso.review.approve'),
                  }).then((ok) => {
                    if (ok) approve.mutate(undefined, { onSuccess: () => toast({ message: t('iso.review.approved') }), onError: fail });
                  })
                }
              >
                {t('iso.review.approve')}
              </button>
              <button type="button" className="btn danger-ghost" onClick={() => setReturning(true)}>
                {t('iso.review.return')}
              </button>
            </div>
          ) : (
            <p className="muted small">{t('iso.review.waiting')}</p>
          )}
        </section>
      ) : null}
      {returning ? (
        <ReasonDialog
          title={t('iso.review.returnTitle')}
          label={t('iso.review.returnReason')}
          confirmLabel={t('iso.review.return')}
          busy={back.isPending}
          onClose={() => setReturning(false)}
          onConfirm={(reason) =>
            back.mutate(
              { reason },
              {
                onSuccess: () => {
                  setReturning(false);
                  toast({ message: t('iso.review.returnedToast') });
                },
                onError: fail,
              },
            )
          }
        />
      ) : null}
    </aside>
  );
}
