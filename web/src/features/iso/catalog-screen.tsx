import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { formatDate, todayIso } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { DatePicker } from '@/ui/date-picker';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, FormSection, PageHeader } from '@/ui/page-header';
import { RowActions } from '@/ui/row-actions';
import { Select } from '@/ui/select';
import { SubmitButton } from '@/ui/submit-button';
import { Tabs, TabPanel } from '@/ui/tabs';
import { useToast } from '@/ui/toast';
import { useFormErrors, useSubmitError } from '@/ui/use-form-errors';
import { ISO_KEY, useDivisions, useIsoWrite, useJobs, useOwners } from './iso-api';
import { lineStorage, pointsError } from './iso-rules';
import type { Division, FormOwners, IsoPerson, Job, JobLine } from './iso-types';

type Tab = 'jobs' | 'divisions' | 'owners';
const TABS: Tab[] = ['jobs', 'divisions', 'owners'];

/**
 * Danh mục phiếu: job backup của 0203, bộ phận của 0208, người phụ trách từng loại
 * phiếu. Thêm / sửa / ngừng chỉ áp cho kỳ còn Đang ghi; kỳ đã gửi chốt giữ danh sách lúc chốt.
 */
export function CatalogScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'jobs';
  const jobs = useJobs('live');
  const divisions = useDivisions();
  return (
    <>
      <PageHeader
        title={t('nav.isoCatalog')}
        subtitle={t('iso.catalog.subtitle')}
        actions={
          <>
            <Link to={PATHS.isoBackup}>{t('nav.isoBackup')}</Link>
            <Link to={PATHS.isoAntivirus}>{t('nav.isoAntivirus')}</Link>
          </>
        }
      />
      <Tabs
        ariaLabel={t('iso.catalog.tabs')}
        value={tab}
        onChange={(key) => setParams({ tab: key }, { replace: true })}
        items={[
          { key: 'jobs', label: t('iso.catalog.tabJobs'), count: jobs.data?.length },
          { key: 'divisions', label: t('iso.catalog.tabDivisions'), count: divisions.data?.filter((d) => d.active).length },
          { key: 'owners', label: t('iso.catalog.tabOwners') },
        ]}
      />
      <TabPanel tabKey={tab}>
        {tab === 'jobs' ? <JobsTab me={me} /> : tab === 'divisions' ? <DivisionsTab me={me} /> : <OwnersTab me={me} />}
      </TabPanel>
    </>
  );
}

/* ----------------------------------------------------------------- job --- */

function JobsTab({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [status, setStatus] = useState<'live' | 'stopped' | 'all'>('live');
  const jobs = useJobs(status);
  const [editing, setEditing] = useState<Job | 'new' | null>(null);
  const [stopping, setStopping] = useState<Job | null>(null);
  const write = useIsoWrite<{ id: string; path: string; body?: unknown }>(me.csrfToken, ({ id, path, body }) => ({
    url: `/api/v1/iso/catalog/jobs/${id}/${path}`,
    method: 'POST',
    body: body ?? {},
  }));
  const fail = (err: unknown) => toast({ message: errorMessage(err), tone: 'error' });
  const list = jobs.data ?? [];

  return (
    <section>
      <div className="sheet-toolbar">
        <Select
          value={status}
          ariaLabel={t('iso.catalog.jobStatus')}
          indicateFilled={false}
          options={[
            { value: 'live', label: t('iso.catalog.live') },
            { value: 'stopped', label: t('iso.catalog.stopped') },
            { value: 'all', label: t('iso.catalog.all') },
          ]}
          onChange={(v) => setStatus(v as typeof status)}
        />
        <button type="button" className="btn primary" onClick={() => setEditing('new')}>
          {t('iso.catalog.addJob')}
        </button>
      </div>
      {jobs.isLoading ? (
        <Loading variant="table" />
      ) : jobs.isError ? (
        <LoadError error={jobs.error} onRetry={() => void jobs.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState title={t('iso.catalog.noJobs')} hint={t('iso.catalog.noJobsHint')} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{t('iso.field.no')}</th>
                <th>{t('iso.field.jobName')}</th>
                <th>{t('iso.catalog.subObjects')}</th>
                <th>{t('iso.field.nas')}</th>
                <th>{t('iso.field.cloud')}</th>
                <th>{t('iso.catalog.trackedFrom')}</th>
                <th>{t('iso.catalog.status')}</th>
                <th className="col-center">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((job) => (
                <tr key={job.id} className={job.stoppedOn ? 'muted' : undefined}>
                  <td data-label={t('iso.field.no')}>{job.no}</td>
                  <td data-label={t('iso.field.jobName')}>
                    <strong>{job.name}</strong>
                  </td>
                  <td data-label={t('iso.catalog.subObjects')}>
                    <LineStack lines={job.lines} text={(l) => l.label} />
                  </td>
                  <td data-label={t('iso.field.nas')}>
                    <LineStack lines={job.lines} text={(l) => pointsText(l.pointsNas, l.storageNas)} />
                  </td>
                  <td data-label={t('iso.field.cloud')}>
                    <LineStack lines={job.lines} text={(l) => pointsText(l.pointsCloud, l.storageCloud)} />
                  </td>
                  <td data-label={t('iso.catalog.trackedFrom')}>{formatDate(job.trackedFrom)}</td>
                  <td data-label={t('iso.catalog.status')}>
                    {job.stoppedOn ? (
                      <span className="badge muted">{t('iso.catalog.stoppedOn', { day: formatDate(job.stoppedOn) })}</span>
                    ) : (
                      <span className="badge ok">{t('iso.catalog.live')}</span>
                    )}
                  </td>
                  <td data-label={t('common.actions')}>
                    <RowActions
                      label={t('common.actionsOf', { subject: job.name })}
                      primary={{ label: t('common.edit'), ariaLabel: t('common.editOf', { subject: job.name }), onClick: () => setEditing(job) }}
                      items={
                        job.stoppedOn
                          ? [{ key: 'resume', label: t('iso.catalog.resume'), ok: true, onSelect: () => write.mutate({ id: job.id, path: 'resume' }, { onError: fail }) }]
                          : [
                              { key: 'up', label: t('iso.catalog.moveUp'), onSelect: () => write.mutate({ id: job.id, path: 'move', body: { direction: 'up' } }, { onError: fail }) },
                              { key: 'down', label: t('iso.catalog.moveDown'), onSelect: () => write.mutate({ id: job.id, path: 'move', body: { direction: 'down' } }, { onError: fail }) },
                              { key: 'stop', label: t('iso.catalog.stop'), warn: true, onSelect: () => setStopping(job) },
                            ]
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">{t('iso.catalog.jobsNote')}</p>
      {editing ? <JobDialog me={me} job={editing === 'new' ? null : editing} nextNo={nextNo(list)} onClose={() => setEditing(null)} /> : null}
      {stopping ? <StopDialog me={me} job={stopping} onClose={() => setStopping(null)} /> : null}
    </section>
  );
}

function nextNo(jobs: Job[]): number {
  return jobs.filter((j) => !j.stoppedOn).reduce((max, j) => Math.max(max, j.no), 0) + 1;
}

function pointsText(points: string | null, storage: string | null): string | null {
  return [points, storage].filter(Boolean).join(' · ') || null;
}

/**
 * Mỗi đối tượng con một dòng, và cột NAS / Cloud xếp cùng nhịp đó: đọc ngang một dòng là ra đúng
 * số điểm lưu của đối tượng ấy, như trên phiếu giấy.
 */
function LineStack({ lines, text }: { lines: JobLine[]; text: (line: JobLine) => string | null }) {
  if (lines.length === 1) return <>{text(lines[0]) ?? '—'}</>;
  return (
    <ul className="iso-line-stack">
      {lines.map((l) => (
        <li key={l.id}>{text(l) ?? '—'}</li>
      ))}
    </ul>
  );
}

interface LineDraft {
  id?: string;
  label: string;
  pointsNas: string;
  pointsCloud: string;
}

const blankLine = (): LineDraft => ({ label: '', pointsNas: '', pointsCloud: '' });

function JobDialog({ me, job, nextNo: suggestedNo, onClose }: { me: Me; job: Job | null; nextNo: number; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [no, setNo] = useState(String(job?.no ?? suggestedNo));
  const [name, setName] = useState(job?.name ?? '');
  // Job mới mặc định theo dõi từ ngày 1 của tháng: khai job giữa tháng thì vẫn đánh bù được các
  // ngày đã qua; job thật sự bắt đầu sau thì đổi ngày này.
  const [trackedFrom, setTrackedFrom] = useState(job?.trackedFrom ?? `${todayIso().slice(0, 7)}-01`);
  const [lines, setLines] = useState<LineDraft[]>(
    job?.lines.map((l) => ({
      id: l.id,
      label: l.label ?? '',
      pointsNas: l.pointsNas ?? '',
      pointsCloud: l.pointsCloud ?? '',
    })) ?? [blankLine()],
  );
  const [error, setError] = useSubmitError([no, name, trackedFrom, lines]);
  const save = useIsoWrite<void, Job>(me.csrfToken, () => ({
    url: job ? `/api/v1/iso/catalog/jobs/${job.id}` : '/api/v1/iso/catalog/jobs',
    method: job ? 'PATCH' : 'POST',
    body: {
      no: Number(no),
      name: name.trim(),
      trackedFrom,
      lines: lines.map((l) => ({
        ...(l.id ? { id: l.id } : {}),
        label: l.label.trim() || null,
        pointsNas: l.pointsNas.trim() || null,
        storageNas: lineStorage(l.pointsNas, 'NAS'),
        pointsCloud: l.pointsCloud.trim() || null,
        storageCloud: lineStorage(l.pointsCloud, 'Cloud'),
      })),
    },
  }));
  const check = useFormErrors({
    no: !/^\d{1,3}$/.test(no) || Number(no) < 1 ? t('iso.catalog.noInvalid') : false,
    name: !name.trim() && t('iso.catalog.nameRequired'),
    lines:
      lines.length > 1 && lines.some((l) => !l.label.trim())
        ? t('iso.catalog.subLabelRequired')
        : lines.some((l) => pointsError(l.pointsNas) || pointsError(l.pointsCloud)) && t('iso.catalog.pointsInvalid'),
  });
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!save.isPending}
      guardUnsaved
      maxWidth={900}
      title={job ? t('iso.catalog.editJob', { name: job.name }) : t('iso.catalog.addJobTitle')}
      footer={
        <>
          <DialogCancel disabled={save.isPending}>{t('common.cancel')}</DialogCancel>
          <SubmitButton form="iso-job-form" busy={save.isPending} succeeded={save.isSuccess} />
        </>
      }
    >
      <form
        id="iso-job-form"
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          save.mutate(undefined, {
            onSuccess: () => {
              toast({ message: t('iso.catalog.jobSaved') });
              onClose();
            },
            onError: (err) => setError(errorMessage(err)),
          });
        }}
      >
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
        <FormSection columns={3}>
          <Field label={t('iso.field.jobName')} required htmlFor="iso-job-name" error={check.error('name')}>
            <input id="iso-job-name" className="inp mono" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('iso.catalog.no')} required htmlFor="iso-job-no" error={check.error('no')}>
            <input id="iso-job-no" className="inp" inputMode="numeric" value={no} onChange={(e) => setNo(e.target.value)} />
          </Field>
          <Field label={t('iso.catalog.trackedFrom')} required hint={t('iso.catalog.trackedFromHint')} htmlFor="iso-job-from">
            <DatePicker id="iso-job-from" value={trackedFrom} onChange={setTrackedFrom} />
          </Field>
        </FormSection>
        <FormSection title={t('iso.catalog.linesTitle')} titleTip={t('iso.catalog.linesTip')} columns={1}>
          {check.error('lines') ? <p className="field-error">{check.error('lines')}</p> : null}
          <div className="table-wrap">
            <table className="table iso-lines">
              <thead>
                <tr>
                  <th>{t('iso.catalog.subObject')}</th>
                  <th className="iso-lines-num">{t('iso.field.pointsNas')}</th>
                  <th className="iso-lines-place">{t('iso.field.storageLocation')}</th>
                  <th className="iso-lines-num">{t('iso.field.pointsCloud')}</th>
                  <th className="iso-lines-place">{t('iso.field.storageLocation')}</th>
                  <th className="iso-lines-x">
                    <span className="sr-only">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={line.id ?? `new-${i}`}>
                    <td>
                      <input
                        className="inp"
                        aria-label={t('iso.catalog.subObjectN', { n: i + 1 })}
                        placeholder={lines.length === 1 ? t('iso.catalog.subOptional') : ''}
                        value={line.label}
                        onChange={(e) => setLine(i, { label: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="inp"
                        inputMode="numeric"
                        aria-label={`Points NAS ${i + 1}`}
                        aria-invalid={pointsError(line.pointsNas) ? true : undefined}
                        value={line.pointsNas}
                        onChange={(e) => setLine(i, { pointsNas: e.target.value })}
                      />
                    </td>
                    <td className="muted">{lineStorage(line.pointsNas, 'NAS') ?? '—'}</td>
                    <td>
                      <input
                        className="inp"
                        inputMode="numeric"
                        aria-label={`Points Cloud ${i + 1}`}
                        aria-invalid={pointsError(line.pointsCloud) ? true : undefined}
                        value={line.pointsCloud}
                        onChange={(e) => setLine(i, { pointsCloud: e.target.value })}
                      />
                    </td>
                    <td className="muted">{lineStorage(line.pointsCloud, 'Cloud') ?? '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-x danger"
                        disabled={lines.length === 1}
                        aria-label={t('iso.catalog.removeSub', { n: i + 1 })}
                        onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">{t('iso.catalog.storageNote')}</p>
          <div>
            <button type="button" className="btn sm" onClick={() => setLines((ls) => [...ls, blankLine()])}>
              {t('iso.catalog.addSub')}
            </button>
          </div>
        </FormSection>
      </form>
    </Dialog>
  );
}

function StopDialog({ me, job, onClose }: { me: Me; job: Job; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [day, setDay] = useState(() => todayIso());
  const stop = useIsoWrite<void>(me.csrfToken, () => ({ url: `/api/v1/iso/catalog/jobs/${job.id}/stop`, method: 'POST', body: { stoppedOn: day } }));
  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!stop.isPending}
      title={t('iso.catalog.stopTitle', { name: job.name })}
      footer={
        <>
          <DialogCancel disabled={stop.isPending}>{t('common.cancel')}</DialogCancel>
          <button
            type="button"
            className="btn caution"
            disabled={stop.isPending || !day}
            onClick={() =>
              stop.mutate(undefined, {
                onSuccess: () => {
                  toast({ message: t('iso.catalog.stopDone') });
                  onClose();
                },
                onError: (err) => toast({ message: errorMessage(err), tone: 'error' }),
              })
            }
          >
            {t('iso.catalog.stop')}
          </button>
        </>
      }
    >
      <Field label={t('iso.catalog.stopOn')} hint={t('iso.catalog.stopHint')} htmlFor="iso-stop-day">
        <DatePicker id="iso-stop-day" value={day} min={job.trackedFrom} onChange={setDay} />
      </Field>
    </Dialog>
  );
}

/* ------------------------------------------------------------- bộ phận --- */

function DivisionsTab({ me }: { me: Me }) {
  const { t } = useTranslation();
  const divisions = useDivisions();
  const [editing, setEditing] = useState<Division | 'new' | null>(null);
  const list = divisions.data ?? [];
  return (
    <section>
      <div className="sheet-toolbar">
        <p className="muted small">{t('iso.catalog.divisionsHint')}</p>
        <button type="button" className="btn primary" onClick={() => setEditing('new')}>
          {t('iso.catalog.addDivision')}
        </button>
      </div>
      {divisions.isLoading ? (
        <Loading />
      ) : divisions.isError ? (
        <LoadError error={divisions.error} onRetry={() => void divisions.refetch()} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{t('iso.catalog.code')}</th>
                <th>{t('iso.catalog.divisionName')}</th>
                <th>{t('iso.catalog.status')}</th>
                <th className="col-center">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className={d.active ? undefined : 'muted'}>
                  <td data-label={t('iso.catalog.code')}>{d.code ?? '—'}</td>
                  <td data-label={t('iso.catalog.divisionName')}>
                    <strong>{d.name}</strong>
                  </td>
                  <td data-label={t('iso.catalog.status')}>
                    <span className={`badge ${d.active ? 'ok' : 'muted'}`}>{d.active ? t('iso.catalog.inUse') : t('iso.catalog.notInUse')}</span>
                  </td>
                  <td data-label={t('common.actions')}>
                    <button type="button" className="btn sm ghost" aria-label={t('common.editOf', { subject: d.name })} onClick={() => setEditing(d)}>
                      {t('common.edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <DivisionDialog me={me} division={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function DivisionDialog({ me, division, onClose }: { me: Me; division: Division | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [code, setCode] = useState(division?.code ?? '');
  const [name, setName] = useState(division?.name ?? '');
  const [active, setActive] = useState(division?.active ?? true);
  const [error, setError] = useSubmitError([code, name, active]);
  const save = useIsoWrite<void>(me.csrfToken, () => ({
    url: division ? `/api/v1/iso/catalog/divisions/${division.id}` : '/api/v1/iso/catalog/divisions',
    method: division ? 'PATCH' : 'POST',
    body: division ? { code: code.trim() || null, name: name.trim(), active } : { code: code.trim() || null, name: name.trim() },
  }));
  const check = useFormErrors({ name: !name.trim() && t('iso.catalog.divisionNameRequired') });
  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!save.isPending}
      guardUnsaved
      title={division ? t('iso.catalog.editDivision', { name: division.name }) : t('iso.catalog.addDivision')}
      footer={
        <>
          <DialogCancel disabled={save.isPending}>{t('common.cancel')}</DialogCancel>
          <SubmitButton form="iso-division-form" busy={save.isPending} succeeded={save.isSuccess} />
        </>
      }
    >
      <form
        id="iso-division-form"
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          save.mutate(undefined, {
            onSuccess: () => {
              toast({ message: t('iso.catalog.divisionSaved') });
              onClose();
            },
            onError: (err) => setError(errorMessage(err)),
          });
        }}
      >
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
        <FormSection columns={2}>
          <Field label={t('iso.catalog.code')} htmlFor="iso-div-code">
            <input id="iso-div-code" className="inp" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label={t('iso.catalog.divisionName')} required hint={t('iso.catalog.divisionNameHint')} htmlFor="iso-div-name" error={check.error('name')}>
            <input id="iso-div-name" className="inp" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {division ? (
            <label className="filter-check">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              {t('iso.catalog.inUse')}
            </label>
          ) : null}
        </FormSection>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------- người phụ trách --- */

function OwnersTab({ me }: { me: Me }) {
  const { t } = useTranslation();
  const owners = useOwners();
  const manager = me.role === 'sa' || me.role === 'admin';
  const people = useQuery({
    queryKey: [...ISO_KEY, 'people'],
    queryFn: () => apiFetch<IsoPerson[]>('/api/v1/iso/catalog/people'),
    enabled: manager,
  });
  return (
    <section>
      <p className="alert info">{t('iso.catalog.ownersHint')}</p>
      {owners.isLoading ? (
        <Loading />
      ) : owners.isError ? (
        <LoadError error={owners.error} onRetry={() => void owners.refetch()} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{t('iso.catalog.form')}</th>
                <th>{t('iso.catalog.primary')}</th>
                <th>{t('iso.catalog.backup')}</th>
                <th>{t('iso.catalog.mailTo')}</th>
                {manager ? <th className="col-center">{t('common.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {(owners.data ?? []).map((row) => (
                <OwnerRow key={row.formType} me={me} row={row} people={people.data ?? []} manager={manager} />
              ))}
              <tr>
                <td data-label={t('iso.catalog.form')}>
                  <strong>0206 · {t('nav.isoIncidents')}</strong>
                </td>
                <td colSpan={manager ? 4 : 3} data-label={t('iso.catalog.primary')} className="muted">
                  {t('iso.catalog.incidentOwnerNote')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function OwnerRow({ me, row, people, manager }: { me: Me; row: FormOwners; people: IsoPerson[]; manager: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [primary, setPrimary] = useState(row.primary?.id ?? '');
  const [backup, setBackup] = useState(row.backup?.id ?? '');
  const save = useIsoWrite<void>(me.csrfToken, () => ({
    url: `/api/v1/iso/catalog/owners/${row.formType}`,
    method: 'PUT',
    body: { primaryUserId: primary || null, backupUserId: backup || null },
  }));
  const options = [{ value: '', label: t('iso.catalog.nobody') }, ...people.map((p) => ({ value: p.id, label: p.fullName, searchText: p.email }))];
  const changed = primary !== (row.primary?.id ?? '') || backup !== (row.backup?.id ?? '');
  const label = row.formType === '0203' ? `0203 · ${t('nav.isoBackup')}` : `0208 · ${t('nav.isoAntivirus')}`;
  return (
    <tr>
      <td data-label={t('iso.catalog.form')}>
        <strong>{label}</strong>
      </td>
      <td data-label={t('iso.catalog.primary')}>
        {manager ? (
          <Select value={primary} ariaLabel={t('iso.catalog.primaryOf', { form: row.formType })} options={options} searchable onChange={setPrimary} />
        ) : (
          (row.primary?.fullName ?? t('iso.catalog.nobody'))
        )}
      </td>
      <td data-label={t('iso.catalog.backup')}>
        {manager ? (
          <Select value={backup} ariaLabel={t('iso.catalog.backupOf', { form: row.formType })} options={options} searchable onChange={setBackup} />
        ) : (
          (row.backup?.fullName ?? t('iso.catalog.nobody'))
        )}
      </td>
      <td data-label={t('iso.catalog.mailTo')} className="small">
        {t('iso.catalog.mailRule')}
      </td>
      {manager ? (
        <td data-label={t('common.actions')}>
          <button
            type="button"
            className="btn sm primary"
            disabled={!changed || save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => toast({ message: t('iso.catalog.ownersSaved', { form: row.formType }) }),
                onError: (err) => toast({ message: errorMessage(err), tone: 'error' }),
              })
            }
          >
            {t('common.save')}
          </button>
        </td>
      ) : null}
    </tr>
  );
}
