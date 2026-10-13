import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage } from '@/lib/api';
import { formatDateTime, todayIso } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { DatePicker } from '@/ui/date-picker';
import { LoadError, Loading } from '@/ui/load-state';
import { Field, FormSection, PageHeader } from '@/ui/page-header';
import { SegmentedRadio } from '@/ui/segmented-radio';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { useFormErrors } from '@/ui/use-form-errors';
import { ISO_KEY, useIncident, useIsoWrite, useLinkable } from './iso-api';
import { IncidentPaper } from './iso-paper';
import { fromVnParts, monthKey, monthLabel, shortDay, toVnParts } from './iso-rules';
import {
  BACKUP_DATA_TYPES,
  BACKUP_DETAIL_MAX,
  BACKUP_TYPES,
  INCIDENT_KINDS,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_STATUS_TONE,
  type BackupDetail,
  type Incident,
  type IncidentCell,
  type IncidentContent,
  type IncidentKind,
  type IncidentSeverity,
  type IncidentStatus,
} from './iso-types';

const KIND_LABEL: Record<IncidentKind, string> = { backup: 'Backup', server: 'Server', network: 'Network', database: 'Database', other: 'Other' };
const SEVERITY_LABEL: Record<IncidentSeverity, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const STATUS_LABEL: Record<IncidentStatus, string> = { temporary_fix: 'Temporary Fix', resolved: 'Resolved', in_progress: 'In Progress' };

interface Draft {
  reportedOn: string;
  kind: IncidentKind | '';
  detectDate: string;
  detectTime: string;
  resolveDate: string;
  resolveTime: string;
  severity: IncidentSeverity | '';
  status: IncidentStatus | '';
  description: string;
  correctiveAction: string;
  backupDetails: BackupDetail[];
  cells: IncidentCell[];
}

function blankDetail(): BackupDetail {
  return { jobName: '', typeBackup: null, typeData: null, storage: '', errorMessage: '', resolution: '' };
}

function draftOf(incident: Incident | null, today: string, prefill: IncidentCell | null): Draft {
  if (incident) {
    const d = toVnParts(incident.detectedAt);
    const r = toVnParts(incident.resolvedAt);
    return {
      reportedOn: incident.reportedOn,
      kind: incident.kind,
      detectDate: d.date,
      detectTime: d.time,
      resolveDate: r.date,
      resolveTime: r.time,
      severity: incident.severity,
      status: incident.status,
      description: incident.description,
      correctiveAction: incident.correctiveAction,
      backupDetails: incident.backupDetails,
      cells: incident.cells,
    };
  }
  return {
    reportedOn: today,
    kind: prefill?.form === '0203' ? 'backup' : '',
    detectDate: prefill?.day ?? today,
    detectTime: '',
    resolveDate: '',
    resolveTime: '',
    severity: '',
    status: '',
    description: '',
    correctiveAction: '',
    backupDetails: prefill?.form === '0203' ? [{ ...blankDetail(), jobName: prefill.label.split(' › ')[0] }] : [],
    cells: prefill ? [prefill] : [],
  };
}

function contentOf(draft: Draft): IncidentContent {
  return {
    reportedOn: draft.reportedOn,
    kind: draft.kind as IncidentKind,
    detectedAt: fromVnParts(draft.detectDate, draft.detectTime) ?? '',
    resolvedAt: draft.status === 'in_progress' ? null : fromVnParts(draft.resolveDate, draft.resolveTime),
    severity: draft.severity as IncidentSeverity,
    status: draft.status as IncidentStatus,
    description: draft.description.trim(),
    correctiveAction: draft.correctiveAction.trim(),
    backupDetails: draft.kind === 'backup' ? draft.backupDetails.filter((d) => d.jobName.trim()) : [],
  };
}

function cellKey(c: Pick<IncidentCell, 'form' | 'lineId' | 'day' | 'issueId'>): string {
  return c.form === '0203' ? `0203:${c.lineId}:${c.day}` : `0208:${c.issueId}`;
}

/**
 * Phiếu sự cố 0206 (Story 8.3): điền → xem lại bản phiếu dạng giấy → xác nhận lưu, số phiếu cấp
 * lúc lưu. Phiếu đã khoá theo kỳ chỉ xem, in và tải bản ký riêng. Màn nhập — desktop.
 */
export function IncidentScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const incident = useIncident(isNew ? null : id);
  if (!isNew && incident.isLoading) return <Loading />;
  if (!isNew && incident.isError) return <LoadError error={incident.error} onRetry={() => void incident.refetch()} />;
  const record = isNew ? null : (incident.data ?? null);
  if (record?.locked) return <LockedIncident me={me} incident={record} />;
  return <IncidentEditor key={record?.contentUpdatedAt ?? 'new'} me={me} incident={record} title={record ? t('iso.incident.editTitle', { code: record.code }) : t('iso.incident.newTitle')} />;
}

function IncidentEditor({ me, incident, title }: { me: Me; incident: Incident | null; title: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const linkable = useLinkable();
  const [today] = useState(() => todayIso());
  const prefillKey = params.get('cell');
  const prefill = useMemo(() => (prefillKey ? (linkable.data?.find((c) => cellKey(c) === prefillKey) ?? null) : null), [prefillKey, linkable.data]);
  const [draft, setDraft] = useState<Draft | null>(() => (incident || !prefillKey ? draftOf(incident, today, null) : null));
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [picking, setPicking] = useState(false);

  // Mở từ ô ✗: chờ danh sách ô chưa có phiếu để lấy nhãn ô rồi mới dựng form điền sẵn.
  if (!draft && (linkable.data || linkable.isError)) {
    setDraft(draftOf(null, today, prefill));
  }

  const save = useIsoWrite<Draft, Incident>(me.csrfToken, (d) => ({
    url: incident ? `/api/v1/iso/incidents/${incident.id}` : '/api/v1/iso/incidents',
    method: incident ? 'PATCH' : 'POST',
    body: {
      ...contentOf(d),
      cells: d.cells.map((c) => (c.form === '0203' ? { form: '0203', lineId: c.lineId, day: c.day } : { form: '0208', issueId: c.issueId })),
    },
  }));

  const check = useFormErrors({
    kind: !draft?.kind && t('iso.incident.kindRequired'),
    detectedAt: draft && !fromVnParts(draft.detectDate, draft.detectTime) && t('iso.incident.detectRequired'),
    severity: !draft?.severity && t('iso.incident.severityRequired'),
    status: !draft?.status && t('iso.incident.statusRequired'),
    resolvedAt:
      draft && draft.status && draft.status !== 'in_progress'
        ? !fromVnParts(draft.resolveDate, draft.resolveTime)
          ? t('iso.incident.resolveRequired')
          : (fromVnParts(draft.resolveDate, draft.resolveTime) ?? '') < (fromVnParts(draft.detectDate, draft.detectTime) ?? '') &&
            t('iso.incident.resolveBeforeDetect')
        : false,
    description: !draft?.description.trim() && t('iso.incident.descriptionRequired'),
    correctiveAction: draft?.status !== 'in_progress' && !draft?.correctiveAction.trim() && t('iso.incident.correctiveRequired'),
    backupDetails:
      draft?.kind === 'backup' && draft.backupDetails.filter((d) => d.jobName.trim()).length === 0 && t('iso.incident.detailRequired'),
  });

  if (!draft) return <Loading />;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const setDetail = (index: number, patch: Partial<BackupDetail>) =>
    set(
      'backupDetails',
      draft.backupDetails.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  const period = draft.detectDate ? monthLabel(Number(draft.detectDate.slice(0, 4)), Number(draft.detectDate.slice(5, 7))) : '';
  const linkedKeys = new Set(draft.cells.map(cellKey));
  const candidates = (linkable.data ?? []).filter((c) => !linkedKeys.has(cellKey(c)));

  return (
    <>
      <PageHeader
        title={title}
        subtitle={incident ? t('iso.incident.subtitleEdit') : t('iso.incident.subtitleNew')}
        actions={<Link to={PATHS.isoIncidents}>{t('iso.incident.backToList')}</Link>}
      />
      <ol className="sheet-steps" aria-label={t('iso.steps')}>
        <li data-done={step === 'review' ? '' : undefined} aria-current={step === 'edit' ? 'step' : undefined}>
          {t('iso.incident.stepFill')}
        </li>
        <li aria-current={step === 'review' ? 'step' : undefined}>{t('iso.incident.stepReview')}</li>
        <li>{t('iso.incident.stepSave')}</li>
      </ol>

      {step === 'review' ? (
        <div className="sheet-split">
          <IncidentPaper incident={contentOf(draft)} />
          <aside className="card">
            <h2>{t('iso.incident.checkTitle')}</h2>
            <ul className="sheet-checks">
              <li>
                <span className="sheet-check-icon" aria-hidden="true">
                  ✓
                </span>
                <span>{t('iso.incident.checkRequired')}</span>
              </li>
              <li>
                <span className="sheet-check-icon" aria-hidden="true">
                  ✓
                </span>
                <span>
                  {draft.cells.length > 0
                    ? t('iso.incident.checkCells', { count: draft.cells.length, list: draft.cells.map((c) => `${c.label} · ${shortDay(c.day)} (${c.form})`).join('; ') })
                    : t('iso.incident.checkDirect')}
                </span>
              </li>
              <li>
                <span className="sheet-check-icon" aria-hidden="true">
                  ✓
                </span>
                <span>{t('iso.incident.checkPeriod', { period })}</span>
              </li>
            </ul>
            <p className="muted small">{draft.status === 'in_progress' ? t('iso.incident.inProgressNote') : t('iso.incident.editableNote')}</p>
            <div className="chip-row">
              <button
                type="button"
                className="btn primary"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate(draft, {
                    onSuccess: (saved) => {
                      toast({ message: t('iso.incident.saved', { code: saved.code }) });
                      navigate(PATHS.isoIncident(saved.id), { replace: true });
                    },
                    onError: (err) => {
                      toast({ message: errorMessage(err), tone: 'error' });
                      setStep('edit');
                    },
                  })
                }
              >
                {t('iso.incident.confirmSave')}
              </button>
              <button type="button" className="btn ghost" disabled={save.isPending} onClick={() => setStep('edit')}>
                {t('iso.incident.backToEdit')}
              </button>
            </div>
          </aside>
        </div>
      ) : (
        <div className="sheet-split">
          <form
            ref={check.formRef}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (check.check()) setStep('review');
            }}
          >
            <FormSection title={t('iso.incident.sectionInfo')} columns={3}>
              <Field label="Type of Incident" required span={3} error={check.error('kind')}>
                <SegmentedRadio
                  label="Type of Incident"
                  value={draft.kind}
                  options={INCIDENT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
                  onChange={(v) => setDraft((d) => (d ? { ...d, kind: v, backupDetails: v === 'backup' ? (d.backupDetails.length ? d.backupDetails : [blankDetail()]) : [] } : d))}
                />
              </Field>
              <Field label="Date Report" required htmlFor="iso-inc-report">
                <DatePicker id="iso-inc-report" value={draft.reportedOn} max={today} onChange={(v) => set('reportedOn', v)} />
              </Field>
              <Field label={t('iso.incident.period')} tip={t('iso.incident.periodTip')}>
                <p className="static-value">{period}</p>
              </Field>
              <Field label={t('iso.incident.createdBy')}>
                <p className="static-value">{incident?.createdByName ?? me.fullName}</p>
              </Field>
              <Field label="Detection Time" required htmlFor="iso-inc-detect" error={check.error('detectedAt')}>
                <div className="chip-row">
                  <DatePicker id="iso-inc-detect" value={draft.detectDate} max={today} onChange={(v) => set('detectDate', v)} />
                  <input type="time" className="inp" aria-label={t('iso.incident.detectHour')} value={draft.detectTime} onChange={(e) => set('detectTime', e.target.value)} />
                </div>
              </Field>
              <Field label="Resolution Time" required={draft.status !== 'in_progress'} hint={draft.status === 'in_progress' ? t('iso.incident.resolveEmpty') : undefined} htmlFor="iso-inc-resolve" error={check.error('resolvedAt')}>
                <div className="chip-row">
                  <DatePicker
                    id="iso-inc-resolve"
                    value={draft.status === 'in_progress' ? '' : draft.resolveDate}
                    min={draft.detectDate || undefined}
                    disabled={draft.status === 'in_progress'}
                    clearable
                    onChange={(v) => set('resolveDate', v)}
                  />
                  <input
                    type="time"
                    className="inp"
                    aria-label={t('iso.incident.resolveHour')}
                    disabled={draft.status === 'in_progress'}
                    value={draft.status === 'in_progress' ? '' : draft.resolveTime}
                    onChange={(e) => set('resolveTime', e.target.value)}
                  />
                </div>
              </Field>
              <span />
              <Field label="Severity Level" required error={check.error('severity')}>
                <SegmentedRadio
                  label="Severity Level"
                  value={draft.severity}
                  options={INCIDENT_SEVERITIES.map((k) => ({ value: k, label: SEVERITY_LABEL[k] }))}
                  onChange={(v) => set('severity', v)}
                />
              </Field>
              <Field label="Current Status" required span={2} error={check.error('status')}>
                <SegmentedRadio
                  label="Current Status"
                  value={draft.status}
                  options={INCIDENT_STATUSES.map((k) => ({ value: k, label: STATUS_LABEL[k] }))}
                  onChange={(v) => set('status', v)}
                />
              </Field>
              <Field label="Incident Description" required span={3} htmlFor="iso-inc-desc" error={check.error('description')}>
                <textarea id="iso-inc-desc" className="inp" rows={3} value={draft.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
              <Field label="Corrective Action" required={draft.status !== 'in_progress'} span={3} htmlFor="iso-inc-action" error={check.error('correctiveAction')}>
                <textarea id="iso-inc-action" className="inp" rows={3} value={draft.correctiveAction} onChange={(e) => set('correctiveAction', e.target.value)} />
              </Field>
            </FormSection>

            {draft.kind === 'backup' ? (
              <FormSection title={t('iso.incident.sectionBackup')} titleTip={t('iso.incident.backupMax', { max: BACKUP_DETAIL_MAX })}>
                {check.error('backupDetails') ? <p className="field-error">{check.error('backupDetails')}</p> : null}
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Job Name</th>
                        <th>Type Backup</th>
                        <th>Type Data</th>
                        <th>Storage Location</th>
                        <th>Error Message</th>
                        <th>Issue Resolution</th>
                        <th>{t('common.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.backupDetails.map((row, i) => (
                        <tr key={i}>
                          <td>
                            <input className="inp" aria-label={`Job Name ${i + 1}`} value={row.jobName} onChange={(e) => setDetail(i, { jobName: e.target.value })} />
                          </td>
                          <td>
                            <Select
                              value={row.typeBackup ?? ''}
                              ariaLabel={`Type Backup ${i + 1}`}
                              placeholder="—"
                              options={[{ value: '', label: '—' }, ...BACKUP_TYPES.map((k) => ({ value: k, label: k === 'full' ? 'Full' : k === 'incr' ? 'Incr' : 'Copy' }))]}
                              onChange={(v) => setDetail(i, { typeBackup: (v || null) as BackupDetail['typeBackup'] })}
                            />
                          </td>
                          <td>
                            <Select
                              value={row.typeData ?? ''}
                              ariaLabel={`Type Data ${i + 1}`}
                              placeholder="—"
                              options={[{ value: '', label: '—' }, ...BACKUP_DATA_TYPES.map((k) => ({ value: k, label: k === 'db' ? 'DB' : k === 'app' ? 'App' : 'FileSV' }))]}
                              onChange={(v) => setDetail(i, { typeData: (v || null) as BackupDetail['typeData'] })}
                            />
                          </td>
                          <td>
                            <input className="inp" aria-label={`Storage Location ${i + 1}`} value={row.storage} onChange={(e) => setDetail(i, { storage: e.target.value })} />
                          </td>
                          <td>
                            <input className="inp" aria-label={`Error Message ${i + 1}`} value={row.errorMessage} onChange={(e) => setDetail(i, { errorMessage: e.target.value })} />
                          </td>
                          <td>
                            <input className="inp" aria-label={`Issue Resolution ${i + 1}`} value={row.resolution} onChange={(e) => setDetail(i, { resolution: e.target.value })} />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-x danger"
                              aria-label={t('iso.incident.removeDetail', { n: i + 1 })}
                              onClick={() => set('backupDetails', draft.backupDetails.filter((_, j) => j !== i))}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  className="btn sm"
                  disabled={draft.backupDetails.length >= BACKUP_DETAIL_MAX}
                  onClick={() => set('backupDetails', [...draft.backupDetails, blankDetail()])}
                >
                  {t('iso.incident.addDetail')}
                </button>
              </FormSection>
            ) : null}
            <div className="chip-row">
              <button type="submit" className="btn primary">
                {t('iso.incident.toReview')}
              </button>
              <Link to={PATHS.isoIncidents}>{t('common.cancel')}</Link>
            </div>
          </form>

          <aside className="card" aria-labelledby="iso-inc-cells">
            <h2 id="iso-inc-cells">{t('iso.incident.cellsTitle')}</h2>
            {draft.cells.length === 0 ? <p className="muted small">{t('iso.incident.noCells')}</p> : null}
            <ul className="sheet-checks">
              {draft.cells.map((c) => (
                <li key={cellKey(c)}>
                  <span className="sheet-mark" data-state="fail">
                    ✗
                  </span>
                  <span>
                    <strong>{c.label}</strong>
                    <span className="cell-sub">
                      {c.form} · {shortDay(c.day)}
                    </span>
                    <button
                      type="button"
                      className="btn sm ghost"
                      aria-label={t('iso.incident.unlink', { name: c.label, day: shortDay(c.day) })}
                      onClick={() => set('cells', draft.cells.filter((x) => cellKey(x) !== cellKey(c)))}
                    >
                      {t('iso.incident.unlinkShort')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="btn sm" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
              {t('iso.incident.linkMore')}
            </button>
            {picking ? (
              candidates.length === 0 ? (
                <p className="muted small">{t('iso.incident.noLinkable')}</p>
              ) : (
                <fieldset className="sheet-checks">
                  <legend className="muted small">{t('iso.incident.linkableLegend')}</legend>
                  {candidates.map((c) => (
                    <label key={cellKey(c)} className="filter-check">
                      <input type="checkbox" onChange={(e) => (e.target.checked ? set('cells', [...draft.cells, c]) : undefined)} />
                      {c.form} · {c.label} · {shortDay(c.day)}
                    </label>
                  ))}
                </fieldset>
              )
            ) : null}
            <p className="muted small">{t('iso.incident.cellsHint')}</p>
          </aside>
        </div>
      )}
    </>
  );
}

/** Phiếu đã khoá theo kỳ: chỉ xem, in, tải bản ký riêng của phiếu (Q-28). */
function LockedIncident({ me, incident }: { me: Me; incident: Incident }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return (
    <>
      <div className="no-print">
        <PageHeader
          title={t('iso.incident.viewTitle', { code: incident.code })}
          subtitle={t('iso.incident.lockedSubtitle', { period: monthLabel(incident.year, incident.month) })}
          actions={
            <>
              <Link to={PATHS.isoIncidents}>{t('iso.incident.backToList')}</Link>
              <button type="button" className="btn" onClick={() => window.print()}>
                {t('iso.print')}
              </button>
            </>
          }
        />
        <p className="alert info">
          <span className={`badge ${INCIDENT_STATUS_TONE[incident.status]}`}>{STATUS_LABEL[incident.status]}</span>{' '}
          {t('iso.incident.lockedHint')}{' '}
          <Link to={PATHS.isoPeriod(incident.governing[0], monthKey(incident.year, incident.month))}>{t('iso.openPeriods')}</Link>
        </p>
      </div>
      <div className="sheet-split">
        <IncidentPaper incident={incident} />
        <aside className="card no-print" aria-labelledby="iso-inc-signed">
          <h2 id="iso-inc-signed">{t('iso.signedTitle')}</h2>
          <p className="muted small">
            {incident.signedCurrent ? t('iso.signedHas') : t('iso.signedMissing')} · {t('iso.incident.createdAt', { at: formatDateTime(incident.createdAt) })}
          </p>
          <AttachmentPanel
            ownerType="iso_incident"
            ownerId={incident.id}
            csrfToken={me.csrfToken}
            accept=".pdf,.jpg,.jpeg,.png"
            staleBefore={incident.contentUpdatedAt}
            onChanged={() => void queryClient.invalidateQueries({ queryKey: ISO_KEY })}
          />
        </aside>
      </div>
    </>
  );
}
