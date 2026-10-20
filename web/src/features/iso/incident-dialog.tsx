import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage } from '@/lib/api';
import { todayIso } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { canSee } from '@/lib/features';
import { DatePicker } from '@/ui/date-picker';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { LoadError, Loading } from '@/ui/load-state';
import { CloseIcon } from '@/ui/glyph-icons';
import { Field, FormSection } from '@/ui/page-header';
import { SegmentedRadio } from '@/ui/segmented-radio';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { useFormErrors, useSubmitError } from '@/ui/use-form-errors';
import { useIncident, useIsoWrite, useJobs, useLinkable } from './iso-api';
import { IncidentPaper, KIND_LABEL, SEVERITY_LABEL, STATUS_LABEL } from './iso-paper';
import { fromVnParts, monthLabel, shortDay, toVnParts } from './iso-rules';
import {
  BACKUP_DATA_TYPES,
  BACKUP_DETAIL_MAX,
  BACKUP_TYPES,
  INCIDENT_KINDS,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  type BackupDetail,
  type Incident,
  type IncidentCell,
  type IncidentContent,
  type IncidentKind,
  type IncidentSeverity,
  type IncidentStatus,
} from './iso-types';

const TYPE_BACKUP_LABEL: Record<NonNullable<BackupDetail['typeBackup']>, string> = { full: 'Full', incr: 'Incr', copy: 'Copy' };
/** Nơi lưu backup — cùng hai giá trị "Storage location" của 0203. */
const STORAGE_PLACES = ['NAS', 'Cloud'];

const TYPE_DATA_LABEL: Record<NonNullable<BackupDetail['typeData']>, string> = { db: 'DB', app: 'App', filesv: 'FileSV' };

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
    backupDetails: prefill?.form === '0203' ? [{ ...blankDetail(), jobName: prefill.label }] : [],
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

/** Khoá một ô có thể gắn phiếu — cùng dạng tham số `?cell=` của link sâu `/iso/incidents/new`. */
export function cellKey(c: Pick<IncidentCell, 'form' | 'lineId' | 'day' | 'issueId'>): string {
  return c.form === '0203' ? `0203:${c.lineId}:${c.day}` : `0208:${c.issueId}`;
}

/**
 * Lập / sửa phiếu 0206 ngay tại màn đang đứng (lưới 0203, 0208, danh sách sự cố): người dùng
 * không mất chỗ trên lưới, lưu xong ô tự đổi sang "✗ đã có 0206". Hai bước như Q-28 trong cùng
 * một hộp: form gọn (chỉ cuộn dọc, không bảng ngang) → bản phiếu đúng mẫu để xem lại → lưu.
 *
 * `incidentId` = sửa phiếu đó; phiếu đã khoá theo kỳ hoặc kỳ đang Chờ duyệt thì hộp chỉ hiện bản
 * phiếu kèm lối mở trang phiếu (in, bản ký). `cell` = ô ✗ điền sẵn khi lập mới — nơi mở hộp
 * đã có đủ nhãn ô, không chờ danh sách ô chưa gắn tải lại (ô vừa đánh ✗ chưa kịp có trong đó).
 */
export function IncidentDialog({
  me,
  incidentId,
  cell,
  onClose,
  onSaved,
}: {
  me: Me;
  incidentId?: string | null;
  cell?: IncidentCell | null;
  onClose: () => void;
  onSaved: (saved: Incident) => void;
}) {
  const { t } = useTranslation();
  const incident = useIncident(incidentId ?? null);
  const linkable = useLinkable();
  const record = incidentId ? (incident.data ?? null) : null;
  const waiting = Boolean(incidentId) && incident.isLoading;
  const title = record ? t('iso.incident.editTitle', { code: record.code }) : t('iso.incident.newTitle');

  // Không có quyền sửa (không phụ trách phiếu chứa ô) thì cũng chỉ xem — mở form cho gõ rồi để
  // API từ chối lúc lưu là bắt người dùng làm không công.
  const readOnly = record !== null && (record.locked || record.inReview || record.canWrite === false);
  if (waiting || (incidentId && incident.isError) || readOnly) {
    return (
      <Dialog
        open
        onOpenChange={onClose}
        maxWidth={960}
        title={record ? t('iso.incident.viewTitle', { code: record.code }) : title}
        footer={
          <>
            <DialogCancel>{t('common.close')}</DialogCancel>
            {record ? (
              <Link className="linkbtn primary" to={PATHS.isoIncident(record.id)}>
                {t('iso.incident.openPage')}
              </Link>
            ) : null}
          </>
        }
      >
        {waiting ? (
          <Loading />
        ) : incident.isError ? (
          <LoadError error={incident.error} onRetry={() => void incident.refetch()} />
        ) : record ? (
          <>
            <p className="alert info">
              {t(record.inReview ? 'iso.incident.reviewHint' : record.locked ? 'iso.incident.lockedHint' : 'iso.incident.noWriteHint')}
            </p>
            <IncidentPaper incident={record} />
          </>
        ) : null}
      </Dialog>
    );
  }

  return (
    <IncidentForm
      key={record?.contentUpdatedAt ?? 'new'}
      me={me}
      incident={record}
      prefill={cell ?? null}
      linkable={linkable.data ?? []}
      title={title}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function IncidentForm({
  me,
  incident,
  prefill,
  linkable,
  title,
  onClose,
  onSaved,
}: {
  me: Me;
  incident: Incident | null;
  prefill: IncidentCell | null;
  linkable: IncidentCell[];
  title: string;
  onClose: () => void;
  onSaved: (saved: Incident) => void;
}) {
  const { t } = useTranslation();
  const [today] = useState(() => todayIso());
  const [draft, setDraft] = useState<Draft>(() => draftOf(incident, today, prefill));
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [error, setError] = useSubmitError([draft]);
  const jobs = useJobs('live');

  const save = useIsoWrite<Draft, Incident>(me.csrfToken, (d) => ({
    url: incident ? `/api/v1/iso/incidents/${incident.id}` : '/api/v1/iso/incidents',
    method: incident ? 'PATCH' : 'POST',
    body: {
      ...contentOf(d),
      cells: d.cells.map((c) => (c.form === '0203' ? { form: '0203', lineId: c.lineId, day: c.day } : { form: '0208', issueId: c.issueId })),
    },
  }));

  const inProgress = draft.status === 'in_progress';
  const detected = fromVnParts(draft.detectDate, draft.detectTime);
  const resolved = fromVnParts(draft.resolveDate, draft.resolveTime);
  const check = useFormErrors({
    kind: !draft.kind && t('iso.incident.kindRequired'),
    severity: !draft.severity && t('iso.incident.severityRequired'),
    status: !draft.status && t('iso.incident.statusRequired'),
    detectedAt: !detected && t('iso.incident.detectRequired'),
    resolvedAt:
      draft.status && !inProgress
        ? !resolved
          ? t('iso.incident.resolveRequired')
          : (resolved ?? '') < (detected ?? '') && t('iso.incident.resolveBeforeDetect')
        : false,
    description: !draft.description.trim() && t('iso.incident.descriptionRequired'),
    correctiveAction: !inProgress && !draft.correctiveAction.trim() && t('iso.incident.correctiveRequired'),
    backupDetails: draft.kind === 'backup' && draft.backupDetails.filter((d) => d.jobName.trim()).length === 0 && t('iso.incident.detailRequired'),
  });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setDetail = (index: number, patch: Partial<BackupDetail>) =>
    set(
      'backupDetails',
      draft.backupDetails.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  const period = draft.detectDate ? monthLabel(Number(draft.detectDate.slice(0, 4)), Number(draft.detectDate.slice(5, 7))) : '';
  const linked = new Set(draft.cells.map(cellKey));
  const candidates = linkable.filter((c) => !linked.has(cellKey(c)));
  const cellText = (c: IncidentCell) => `${c.form} · ${c.label} · ${shortDay(c.day)}`;
  // Job Name chọn từ đúng các dòng của lưới 0203 (job › đối tượng con) — gõ tay thì tên trên 0206
  // lệch tên trên 0203 và không ai đối chiếu được. Giá trị cũ không còn trong danh sách vẫn giữ.
  const jobNames = (jobs.data ?? []).flatMap((j) => j.lines.map((l) => (l.label ? `${j.name} › ${l.label}` : j.name)));
  const jobOptions = (current: string) =>
    [...new Set([...(current && !jobNames.includes(current) ? [current] : []), ...jobNames])].map((name) => ({ value: name, label: name }));
  const storageOptions = (current: string) =>
    [...new Set([...(current && !STORAGE_PLACES.includes(current) ? [current] : []), ...STORAGE_PLACES])].map((v) => ({ value: v, label: v }));

  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!save.isPending}
      guardUnsaved
      maxWidth={960}
      title={title}
      footer={
        step === 'edit' ? (
          <>
            <DialogCancel>{t('common.cancel')}</DialogCancel>
            <button type="submit" form="iso-incident-form" className="btn primary">
              {t('iso.incident.toReview')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn ghost" disabled={save.isPending} onClick={() => setStep('edit')}>
              {t('iso.incident.backToEdit')}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={save.isPending}
              onClick={() =>
                save.mutate(draft, {
                  onSuccess: onSaved,
                  onError: (err) => {
                    setStep('edit');
                    setError(errorMessage(err));
                  },
                })
              }
            >
              {t('iso.incident.confirmSave')}
            </button>
          </>
        )
      }
    >
      {step === 'review' ? (
        <div className="iso-incident-review">
          <IncidentPaper incident={contentOf(draft)} />
          <ul className="sheet-checks">
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
          <p className="muted small">{inProgress ? t('iso.incident.inProgressNote') : t('iso.incident.editableNote')}</p>
        </div>
      ) : (
        <form
          id="iso-incident-form"
          ref={check.formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (check.check()) setStep('review');
          }}
        >
          {error ? (
            <p className="alert error" role="alert">
              {error}
            </p>
          ) : null}
          {check.summary}

          <section className="iso-incident-cells" aria-label={t('iso.incident.cellsTitle')}>
            <span className="muted small">{t('iso.incident.cellsTitle')}:</span>
            {draft.cells.length === 0 ? <span className="muted small">{t('iso.incident.noCells')}</span> : null}
            {draft.cells.map((c) => (
              <span key={cellKey(c)} className="chip">
                <span className="sheet-mark" data-state="fail" aria-hidden="true">
                  ✗
                </span>
                {cellText(c)}
                <button
                  type="button"
                  aria-label={t('iso.incident.unlink', { name: c.label, day: shortDay(c.day) })}
                  onClick={() => set('cells', draft.cells.filter((x) => cellKey(x) !== cellKey(c)))}
                >
                  <CloseIcon />
                </button>
              </span>
            ))}
            {candidates.length > 0 ? (
              <Select
                value=""
                ariaLabel={t('iso.incident.linkMore')}
                placeholder={t('iso.incident.linkMore')}
                searchable
                indicateFilled={false}
                options={candidates.map((c) => ({ value: cellKey(c), label: cellText(c) }))}
                onChange={(key) => {
                  const picked = candidates.find((c) => cellKey(c) === key);
                  if (picked) set('cells', [...draft.cells, picked]);
                }}
              />
            ) : null}
          </section>

          <FormSection columns={3}>
            <Field label={t('iso.field.typeOfIncident')} required span={2} error={check.error('kind')}>
              <SegmentedRadio
                label={t('iso.field.typeOfIncident')}
                value={draft.kind}
                options={INCIDENT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
                onChange={(v) => setDraft((d) => ({ ...d, kind: v, backupDetails: v === 'backup' ? (d.backupDetails.length ? d.backupDetails : [blankDetail()]) : [] }))}
              />
            </Field>
            <Field label={t('iso.field.severityLevel')} required error={check.error('severity')}>
              <SegmentedRadio
                label={t('iso.field.severityLevel')}
                value={draft.severity}
                options={INCIDENT_SEVERITIES.map((k) => ({ value: k, label: SEVERITY_LABEL[k] }))}
                onChange={(v) => set('severity', v)}
              />
            </Field>
            <Field label={t('iso.field.currentStatus')} required span={2} error={check.error('status')}>
              <SegmentedRadio
                label={t('iso.field.currentStatus')}
                value={draft.status}
                options={INCIDENT_STATUSES.map((k) => ({ value: k, label: STATUS_LABEL[k] }))}
                onChange={(v) => set('status', v)}
              />
            </Field>
            <Field label={t('iso.field.dateReport')} required htmlFor="iso-inc-report">
              <DatePicker id="iso-inc-report" value={draft.reportedOn} max={today} onChange={(v) => set('reportedOn', v)} />
            </Field>
            <Field label={t('iso.field.detectionTime')} required hint={period ? t('iso.incident.periodOf', { period }) : undefined} htmlFor="iso-inc-detect" error={check.error('detectedAt')}>
              <div className="iso-when">
                <DatePicker id="iso-inc-detect" value={draft.detectDate} max={today} onChange={(v) => set('detectDate', v)} />
                <input type="time" className="inp" aria-label={t('iso.incident.detectHour')} value={draft.detectTime} onChange={(e) => set('detectTime', e.target.value)} />
              </div>
            </Field>
            <Field
              label={t('iso.field.resolutionTime')}
              required={!inProgress}
              hint={inProgress ? t('iso.incident.resolveEmpty') : undefined}
              htmlFor="iso-inc-resolve"
              error={check.error('resolvedAt')}
            >
              <div className="iso-when">
                <DatePicker
                  id="iso-inc-resolve"
                  value={inProgress ? '' : draft.resolveDate}
                  min={draft.detectDate || undefined}
                  disabled={inProgress}
                  clearable
                  onChange={(v) => set('resolveDate', v)}
                />
                <input
                  type="time"
                  className="inp"
                  aria-label={t('iso.incident.resolveHour')}
                  disabled={inProgress}
                  value={inProgress ? '' : draft.resolveTime}
                  onChange={(e) => set('resolveTime', e.target.value)}
                />
              </div>
            </Field>
            <Field label={t('iso.incident.createdBy')}>
              <p className="static-value">{incident?.createdByName ?? me.fullName}</p>
            </Field>
          </FormSection>

          <FormSection columns={2}>
            <Field label={t('iso.field.incidentDescription')} required htmlFor="iso-inc-desc" error={check.error('description')}>
              <textarea id="iso-inc-desc" className="inp" rows={4} value={draft.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <Field label={t('iso.field.correctiveAction')} required={!inProgress} htmlFor="iso-inc-action" error={check.error('correctiveAction')}>
              <textarea id="iso-inc-action" className="inp" rows={4} value={draft.correctiveAction} onChange={(e) => set('correctiveAction', e.target.value)} />
            </Field>
          </FormSection>

          {draft.kind === 'backup' ? (
            <FormSection title="Detail Error Backup" titleTip={t('iso.incident.backupMax', { max: BACKUP_DETAIL_MAX })} columns={1}>
              {check.error('backupDetails') ? (
                <p className="field-error" role="alert">
                  {check.error('backupDetails')}
                </p>
              ) : null}
              {draft.backupDetails.map((row, i) => (
                <fieldset key={i} className="iso-detail">
                  <legend className="sr-only">{t('iso.field.jobN', { n: i + 1 })}</legend>
                  <Select
                    value={row.jobName}
                    ariaLabel={t('iso.field.jobNameN', { n: i + 1 })}
                    placeholder={t('iso.field.detailJobName')}
                    searchable
                    options={jobOptions(row.jobName)}
                    onChange={(v) => setDetail(i, { jobName: v })}
                  />
                  <SegmentedRadio
                    label={t('iso.field.typeBackupN', { n: i + 1 })}
                    value={row.typeBackup ?? ''}
                    options={BACKUP_TYPES.map((k) => ({ value: k, label: TYPE_BACKUP_LABEL[k] }))}
                    // Bấm lại lựa chọn đang bật thì bỏ chọn: mẫu giấy cho để trống cột này.
                    onChange={(v) => setDetail(i, { typeBackup: row.typeBackup === v ? null : v })}
                  />
                  <SegmentedRadio
                    label={t('iso.field.typeDataN', { n: i + 1 })}
                    value={row.typeData ?? ''}
                    options={BACKUP_DATA_TYPES.map((k) => ({ value: k, label: TYPE_DATA_LABEL[k] }))}
                    onChange={(v) => setDetail(i, { typeData: row.typeData === v ? null : v })}
                  />
                  <button
                    type="button"
                    className="btn-x danger"
                    aria-label={t('iso.incident.removeDetail', { n: i + 1 })}
                    onClick={() => set('backupDetails', draft.backupDetails.filter((_, j) => j !== i))}
                  >
                    <CloseIcon />
                  </button>
                  <div className="iso-detail-more">
                    <Select
                      value={row.storage}
                      ariaLabel={t('iso.field.storageN', { n: i + 1 })}
                      placeholder={t('iso.field.detailStorage')}
                      options={storageOptions(row.storage)}
                      onChange={(v) => setDetail(i, { storage: v })}
                    />
                    <input className="inp" aria-label={t('iso.field.errorMessageN', { n: i + 1 })} placeholder={t('iso.field.errorMessage')} value={row.errorMessage} onChange={(e) => setDetail(i, { errorMessage: e.target.value })} />
                    <input className="inp" aria-label={t('iso.field.issueResolutionN', { n: i + 1 })} placeholder={t('iso.field.issueResolution')} value={row.resolution} onChange={(e) => setDetail(i, { resolution: e.target.value })} />
                  </div>
                </fieldset>
              ))}
              <div>
                <button
                  type="button"
                  className="btn sm"
                  disabled={draft.backupDetails.length >= BACKUP_DETAIL_MAX}
                  onClick={() => set('backupDetails', [...draft.backupDetails, blankDetail()])}
                >
                  {t('iso.incident.addDetail')}
                </button>
              </div>
            </FormSection>
          ) : null}
        </form>
      )}
    </Dialog>
  );
}

/** Hộp 0206 của một màn: lập mới (kèm ô ✗ điền sẵn, hoặc lập thẳng) hay mở phiếu đã có. */
export type IncidentDialogTarget = { cell: IncidentCell | null } | { incidentId: string };

/**
 * Chỗ đặt `IncidentDialog` trên một màn: lưu xong đóng hộp, báo số phiếu kèm lối mở trang phiếu
 * (toast `action`) — người dùng ở lại lưới, ô đã tự đổi trạng thái nhờ `useIsoWrite` làm mới.
 */
export function IncidentDialogHost({ me, target, onClose }: { me: Me; target: IncidentDialogTarget | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  // Q-31: nhóm quyền ẩn 0206 thì ô ✗ của lưới không mở được phiếu (API cũng trả 403).
  if (!target || !canSee(me, 'iso_0206')) return null;
  return (
    <IncidentDialog
      me={me}
      {...('incidentId' in target ? { incidentId: target.incidentId } : { cell: target.cell })}
      onClose={onClose}
      onSaved={(saved) => {
        onClose();
        toast({ message: t('iso.incident.saved', { code: saved.code }), action: { label: t('iso.incident.openShort'), onClick: () => navigate(PATHS.isoIncident(saved.id)) } });
      }}
    />
  );
}
