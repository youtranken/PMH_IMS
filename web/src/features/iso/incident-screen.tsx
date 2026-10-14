import { useId, useMemo, useState, type ReactNode } from 'react';
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
import { InfoTip } from '@/ui/info-tip';
import { PageHeader } from '@/ui/page-header';
import { useToast } from '@/ui/toast';
import { useFormErrors } from '@/ui/use-form-errors';
import { ISO_KEY, useIncident, useIsoWrite, useLinkable } from './iso-api';
import { BackupDetailHead, IncidentInfoTable, IncidentPaper, KIND_LABEL, PaperHead, SEVERITY_LABEL, SignBlock, STATUS_LABEL } from './iso-paper';
import { fromVnParts, monthKey, monthLabel, shortDay, toVnParts } from './iso-rules';
import {
  BACKUP_DATA_TYPES,
  BACKUP_DETAIL_MAX,
  BACKUP_TYPES,
  INCIDENT_STATUS_TONE,
  type BackupDetail,
  type Incident,
  type IncidentCell,
  type IncidentContent,
  type IncidentKind,
  type IncidentSeverity,
  type IncidentStatus,
} from './iso-types';

const TYPE_BACKUP_LABEL: Record<NonNullable<BackupDetail['typeBackup']>, string> = { full: 'Full', incr: 'Incr', copy: 'Copy' };
const TYPE_DATA_LABEL: Record<NonNullable<BackupDetail['typeData']>, string> = { db: 'DB', app: 'App', filesv: 'FileSV' };

/**
 * Một ô của khung phiếu: lỗi dưới ô như `Field` (lớp `.field` / `.field-error` để `useFormErrors`
 * tìm ra ô lỗi đầu tiên và đưa tiêu điểm tới), nhưng nhãn nằm ở cột nhãn của khung như mẫu giấy.
 */
function Cell({ error, hint, children }: { error?: string | null; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
      {hint ? <span className="field-hint muted">{hint}</span> : null}
    </div>
  );
}

/** Ô tick chọn một như mẫu giấy ("☐ Backup ☐ Server …"); vẫn là nhóm radio thật cho bàn phím và trình đọc màn hình. */
function Choices<K extends string>({
  label,
  labels,
  value,
  invalid,
  onChange,
}: {
  label: string;
  labels: Record<K, string>;
  value: K | '';
  invalid: boolean;
  onChange: (value: K) => void;
}) {
  const name = useId();
  return (
    <span role="radiogroup" aria-label={label} aria-invalid={invalid || undefined} className="paper-options iso-choices">
      {(Object.keys(labels) as K[]).map((key) => (
        <label key={key}>
          <input type="radio" className="iso-tick" name={name} checked={value === key} aria-invalid={invalid || undefined} onChange={() => onChange(key)} />
          {labels[key]}
        </label>
      ))}
    </span>
  );
}

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
 * Phiếu sự cố 0206: điền → xem lại bản phiếu dạng giấy → xác nhận lưu, số phiếu cấp
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
  if (record?.locked || record?.inReview) return <LockedIncident me={me} incident={record} />;
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
            className="iso-form-sheet"
            onSubmit={(e) => {
              e.preventDefault();
              if (check.check()) setStep('review');
            }}
          >
            {check.summary}
            <PaperHead code="SP-IT0206" title="DAILY INCIDENT REPORT FORM" rule />
            <p className="muted small">
              {t('iso.incident.period')}: <strong>{period || '—'}</strong> <InfoTip subject={t('iso.incident.period')}>{t('iso.incident.periodTip')}</InfoTip> ·{' '}
              {t('iso.incident.createdBy')}: <strong>{incident?.createdByName ?? me.fullName}</strong>
            </p>
            <IncidentInfoTable
              ids={{ reported: 'iso-inc-report', detected: 'iso-inc-detect', resolved: 'iso-inc-resolve', description: 'iso-inc-desc', action: 'iso-inc-action' }}
              required={{ resolved: draft.status !== 'in_progress', action: draft.status !== 'in_progress' }}
              slots={{
                reported: <DatePicker id="iso-inc-report" value={draft.reportedOn} max={today} onChange={(v) => set('reportedOn', v)} />,
                detected: (
                  <Cell error={check.error('detectedAt')}>
                    <div className="iso-form-when">
                      <DatePicker id="iso-inc-detect" value={draft.detectDate} max={today} aria-invalid={check.error('detectedAt') ? true : undefined} onChange={(v) => set('detectDate', v)} />
                      <input type="time" className="inp" aria-label={t('iso.incident.detectHour')} value={draft.detectTime} onChange={(e) => set('detectTime', e.target.value)} />
                    </div>
                  </Cell>
                ),
                resolved: (
                  <Cell error={check.error('resolvedAt')} hint={draft.status === 'in_progress' ? t('iso.incident.resolveEmpty') : undefined}>
                    <div className="iso-form-when">
                      <DatePicker
                        id="iso-inc-resolve"
                        value={draft.status === 'in_progress' ? '' : draft.resolveDate}
                        min={draft.detectDate || undefined}
                        disabled={draft.status === 'in_progress'}
                        aria-invalid={check.error('resolvedAt') ? true : undefined}
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
                  </Cell>
                ),
                kind: (
                  <Cell error={check.error('kind')}>
                    <Choices
                      label="Type of Incident"
                      labels={KIND_LABEL}
                      value={draft.kind}
                      invalid={Boolean(check.error('kind'))}
                      onChange={(v) => setDraft((d) => (d ? { ...d, kind: v, backupDetails: v === 'backup' ? (d.backupDetails.length ? d.backupDetails : [blankDetail()]) : [] } : d))}
                    />
                  </Cell>
                ),
                severity: (
                  <Cell error={check.error('severity')}>
                    <Choices label="Severity Level" labels={SEVERITY_LABEL} value={draft.severity} invalid={Boolean(check.error('severity'))} onChange={(v) => set('severity', v)} />
                  </Cell>
                ),
                description: (
                  <Cell error={check.error('description')}>
                    <textarea
                      id="iso-inc-desc"
                      className="inp"
                      rows={6}
                      aria-invalid={check.error('description') ? true : undefined}
                      value={draft.description}
                      onChange={(e) => set('description', e.target.value)}
                    />
                  </Cell>
                ),
                action: (
                  <Cell error={check.error('correctiveAction')}>
                    <textarea
                      id="iso-inc-action"
                      className="inp"
                      rows={6}
                      aria-invalid={check.error('correctiveAction') ? true : undefined}
                      value={draft.correctiveAction}
                      onChange={(e) => set('correctiveAction', e.target.value)}
                    />
                  </Cell>
                ),
                status: (
                  <Cell error={check.error('status')}>
                    <Choices label="Current Status" labels={STATUS_LABEL} value={draft.status} invalid={Boolean(check.error('status'))} onChange={(v) => set('status', v)} />
                  </Cell>
                ),
              }}
            />

            {draft.kind === 'backup' ? (
              <>
                <table className="paper-table paper-form iso-form-details">
                  <colgroup>
                    <col className="iso-col-job" />
                    {Array.from({ length: 6 }, (_, k) => (
                      <col key={k} className="iso-col-tick" />
                    ))}
                    <col className="iso-col-storage" />
                    <col />
                    <col />
                    <col className="iso-col-x" />
                  </colgroup>
                  <BackupDetailHead actions={t('common.actions')} />
                  <tbody>
                    {draft.backupDetails.map((row, i) => (
                      <tr key={i}>
                        <td>
                          <input className="inp" aria-label={`Job Name ${i + 1}`} value={row.jobName} onChange={(e) => setDetail(i, { jobName: e.target.value })} />
                        </td>
                        {BACKUP_TYPES.map((k) => (
                          <td key={k}>
                            <input
                              type="checkbox"
                              className="iso-tick"
                              aria-label={`${TYPE_BACKUP_LABEL[k]} ${i + 1}`}
                              checked={row.typeBackup === k}
                              onChange={(e) => setDetail(i, { typeBackup: e.target.checked ? k : null })}
                            />
                          </td>
                        ))}
                        {BACKUP_DATA_TYPES.map((k) => (
                          <td key={k}>
                            <input
                              type="checkbox"
                              className="iso-tick"
                              aria-label={`${TYPE_DATA_LABEL[k]} ${i + 1}`}
                              checked={row.typeData === k}
                              onChange={(e) => setDetail(i, { typeData: e.target.checked ? k : null })}
                            />
                          </td>
                        ))}
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
                <Cell error={check.error('backupDetails')}>
                  <div className="chip-row">
                    <button
                      type="button"
                      className="btn sm"
                      disabled={draft.backupDetails.length >= BACKUP_DETAIL_MAX}
                      onClick={() => set('backupDetails', [...draft.backupDetails, blankDetail()])}
                    >
                      {t('iso.incident.addDetail')}
                    </button>
                    <span className="muted small">{t('iso.incident.backupMax', { max: BACKUP_DETAIL_MAX })}</span>
                  </div>
                </Cell>
              </>
            ) : null}
            <SignBlock left="Reported By" right="Reviewed and Approved By" joined />
            <p className="muted small">{t('iso.incident.signNote')}</p>
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

/**
 * Phiếu chỉ xem (Q-28): đã khoá theo kỳ (in, tải bản ký riêng của phiếu), hoặc kỳ đang Chờ duyệt
 * (chưa tải bản ký được — bản ký chỉ nhận sau khi kỳ được duyệt chốt).
 */
function LockedIncident({ me, incident }: { me: Me; incident: Incident }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return (
    <>
      <div className="no-print">
        <PageHeader
          title={t('iso.incident.viewTitle', { code: incident.code })}
          subtitle={t(incident.inReview ? 'iso.incident.reviewSubtitle' : 'iso.incident.lockedSubtitle', { period: monthLabel(incident.year, incident.month) })}
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
          {t(incident.inReview ? 'iso.incident.reviewHint' : 'iso.incident.lockedHint')}{' '}
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
            canEdit={incident.canWrite === true && incident.locked}
            accept=".pdf,.jpg,.jpeg,.png"
            staleBefore={incident.contentUpdatedAt}
            onChanged={() => void queryClient.invalidateQueries({ queryKey: ISO_KEY })}
          />
        </aside>
      </div>
    </>
  );
}
