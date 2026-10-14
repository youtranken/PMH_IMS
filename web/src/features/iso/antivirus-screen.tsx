import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage } from '@/lib/api';
import { todayIso } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { useConfirm } from '@/ui/confirm-provider';
import { DatePicker } from '@/ui/date-picker';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { LoadError, Loading } from '@/ui/load-state';
import { Field, FormSection, PageHeader } from '@/ui/page-header';
import { RowActions } from '@/ui/row-actions';
import { Select } from '@/ui/select';
import { SubmitButton } from '@/ui/submit-button';
import { useToast } from '@/ui/toast';
import { useFormErrors, useSubmitError } from '@/ui/use-form-errors';
import { useAntivirusGrid, useDivisions, useIsoWrite, useOwners } from './iso-api';
import { LockedBanner, MonthNav, OwnerNotice, PeriodStateBadge } from './iso-parts';
import {
  avIssueMark,
  avOtherMark,
  avResultDays,
  daysOf,
  groupByDivision,
  monthKey,
  parseMonthParam,
  shortDay,
} from './iso-rules';
import { IncidentDialogHost, type IncidentDialogTarget } from './incident-dialog';
import type { AntivirusGrid, AvIssue, IncidentCell } from './iso-types';

/**
 * Lưới 0208 — Theo dõi antivirus. Mỗi ngày đã qua phải có kết quả: "không có issue",
 * hoặc ít nhất một dòng issue (một máy × một ngày phát hiện). Dòng gom theo bộ phận, chỉ bộ phận có
 * issue trong tháng mới hiện; "Other Division" luôn ở cuối (Q-28). Bấm ô của "Other Division" để
 * đánh / bỏ "không có issue" ngày đó — cùng kiểu bấm ô như 0203. Màn nhập — desktop.
 */
export function AntivirusScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => todayIso());
  const { year, month } = parseMonthParam(params.get('month'), today);
  const key = monthKey(year, month);
  const grid = useAntivirusGrid(key);
  const owners = useOwners();

  return (
    <>
      <PageHeader
        title={t('nav.isoAntivirus')}
        subtitle={t('iso.av.subtitle')}
        actions={
          grid.data ? (
            <Link className={`linkbtn${grid.data.state === 'open' ? ' primary' : ''}`} to={PATHS.isoReview('0208', key)}>
              {t('iso.viewForm')}
            </Link>
          ) : null
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
        <AntivirusBody
          me={me}
          data={grid.data}
          ownerNotice={
            grid.data.state === 'open' && !grid.data.canEdit ? (
              <OwnerNotice form="0208" owners={owners.data?.find((o) => o.formType === '0208')} />
            ) : null
          }
        />
      ) : null}
    </>
  );
}

function AntivirusBody({ me, data, ownerNotice }: { me: Me; data: AntivirusGrid; ownerNotice: React.ReactNode }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const [editing, setEditing] = useState<AvIssue | 'new' | null>(null);
  const [dialog, setDialog] = useState<IncidentDialogTarget | null>(null);
  const days = daysOf(data.year, data.month);
  const groups = useMemo(() => groupByDivision(data.issues), [data.issues]);
  const resultDays = useMemo(() => avResultDays(data.clearDays, data.issues), [data.clearDays, data.issues]);
  const clear = new Set(data.clearDays);
  const missed = new Set(data.summary.missedDays);
  const issueDays = new Set(data.issues.map((i) => i.reportedOn));
  const todayPending = data.summary.pendingDays.includes(data.today);
  const open = data.state === 'open';
  const editable = open && data.canEdit;

  const markClear = useIsoWrite<{ day: string }>(me.csrfToken, (body) => ({ url: '/api/v1/iso/antivirus/clear-days', method: 'POST', body }));
  const unmarkClear = useIsoWrite<{ day: string }>(me.csrfToken, ({ day }) => ({ url: `/api/v1/iso/antivirus/clear-days/${day}`, method: 'DELETE' }));
  const removeIssue = useIsoWrite<{ id: string }>(me.csrfToken, ({ id }) => ({ url: `/api/v1/iso/antivirus/issues/${id}`, method: 'DELETE' }));
  const fail = (err: unknown) => toast({ message: errorMessage(err), tone: 'error' });
  const issueCell = (issue: AvIssue, divisionName: string): IncidentCell => ({
    form: '0208',
    lineId: null,
    day: issue.reportedOn,
    issueId: issue.id,
    label: `${divisionName} · ${issue.computerName}`,
  });
  const toggleClear = (day: string) => {
    if (clear.has(day)) {
      unmarkClear.mutate(
        { day },
        {
          onSuccess: () =>
            toast({
              message: t('iso.av.unmarked', { day: shortDay(day) }),
              action: { label: t('iso.av.undo'), onClick: () => markClear.mutate({ day }, { onError: fail }) },
            }),
          onError: fail,
        },
      );
    } else {
      markClear.mutate({ day }, { onError: fail });
    }
  };
  const markAllPast = async () => {
    const ok = await askConfirm({
      title: t('iso.av.markAllTitle'),
      message: t('iso.av.markAllConfirm', { count: data.summary.missedDays.length, days: data.summary.missedDays.map(shortDay).join(', ') }),
      confirmLabel: t('iso.av.markAll', { count: data.summary.missedDays.length }),
    });
    if (!ok) return;
    for (const day of data.summary.missedDays) {
      try {
        await markClear.mutateAsync({ day });
      } catch (err) {
        fail(err);
        return;
      }
    }
    toast({ message: t('iso.av.markedAll', { count: data.summary.missedDays.length }) });
  };

  return (
    <>
      {!open ? <LockedBanner form="0208" year={data.year} month={data.month} state={data.state} /> : null}
      {ownerNotice}
      {editable ? (
        <section className="card" aria-label={t('iso.av.recordSection')}>
          <p>
            <strong>
              {data.summary.pendingDays.length === 0
                ? t('iso.av.everyDayRecorded')
                : data.summary.missedDays.length > 0
                  ? t(todayPending ? 'iso.av.missedAndToday' : 'iso.av.missedTitle', { count: data.summary.missedDays.length })
                  : t('iso.av.todayPending')}
            </strong>
          </p>
          <p className="muted small">{t('iso.av.recordHint')}</p>
          <div className="chip-row">
            {data.summary.missedDays.length > 1 ? (
              <button type="button" className="btn sm" disabled={markClear.isPending} onClick={() => void markAllPast()}>
                {t('iso.av.markAll', { count: data.summary.missedDays.length })}
              </button>
            ) : null}
            <button type="button" className="btn sm primary" onClick={() => setEditing('new')}>
              {t('iso.av.addIssue')}
            </button>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="iso-av-grid">
        <div className="sheet-toolbar">
          <h2 id="iso-av-grid">{t('iso.grid')}</h2>
          <span className="muted small">
            {t('iso.av.summary', { issues: data.issues.length, divisions: groups.length, missed: data.summary.missedDays.length })}
          </span>
        </div>
        <div className="sheet-scroll">
          <table className="sheet-grid">
            <thead>
              <tr>
                <th scope="col" className="sheet-name">
                  Division
                </th>
                <th scope="col">Reported Date</th>
                <th scope="col">Computer Name</th>
                <th scope="col" className="sheet-left">
                  Incident Description
                </th>
                <th scope="col">Resolution Date</th>
                <th scope="col">Handled</th>
                <th scope="col">{t('iso.av.incidentCol')}</th>
                {editable ? <th scope="col">{t('common.actions')}</th> : null}
                {days.map((d) => (
                  <th
                    key={d.day}
                    scope="col"
                    className="sheet-day"
                    data-today={d.day === data.today ? '' : undefined}
                    data-weekend={d.weekend ? '' : undefined}
                    data-missed={missed.has(d.day) ? '' : undefined}
                  >
                    {d.n}
                    <small>{d.weekday}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) =>
                group.issues.map((issue, i) => (
                  <tr key={issue.id}>
                    <td className="sheet-name">{i === 0 ? group.divisionName : ''}</td>
                    <td>{shortDay(issue.reportedOn)}</td>
                    <td>{issue.computerName}</td>
                    <td className="sheet-left">{issue.description}</td>
                    <td>{issue.resolvedOn ? shortDay(issue.resolvedOn) : t('iso.av.notResolved')}</td>
                    <td>{issue.handledBy}</td>
                    <td>
                      {issue.incident ? (
                        <button type="button" className="btn sm ghost mono" onClick={() => setDialog({ incidentId: issue.incident?.id ?? '' })}>
                          {issue.incident.code}
                        </button>
                      ) : open ? (
                        <button type="button" className="btn sm ghost" onClick={() => setDialog({ cell: issueCell(issue, group.divisionName) })}>
                          {t('iso.createIncident')}
                        </button>
                      ) : null}
                    </td>
                    {editable ? (
                      <td>
                        <RowActions
                          label={t('common.actionsOf', { subject: issue.computerName })}
                          primary={{
                            label: t('common.edit'),
                            ariaLabel: t('common.editOf', { subject: issue.computerName }),
                            onClick: () => setEditing(issue),
                          }}
                          items={
                            issue.incident
                              ? []
                              : [
                                  {
                                    key: 'delete',
                                    label: t('common.delete'),
                                    warn: true,
                                    onSelect: () =>
                                      void askConfirm({
                                        title: t('common.titleOf', { action: t('common.delete'), subject: issue.computerName }),
                                        message: t('iso.av.deleteConfirm', { name: issue.computerName, day: shortDay(issue.reportedOn) }),
                                        danger: true,
                                      }).then((ok) => {
                                        if (ok) removeIssue.mutate({ id: issue.id }, { onError: fail });
                                      }),
                                  },
                                ]
                          }
                        />
                      </td>
                    ) : null}
                    {days.map((d) => {
                      const mark = avIssueMark(issue, d.day, resultDays);
                      const state = mark === '✗' ? (issue.incident ? 'fail-linked' : 'fail') : mark === '✓' ? 'ok' : '';
                      return (
                        <td key={d.day} className="sheet-cell" data-future={d.day > data.today ? '' : undefined}>
                          <span className="sheet-mark" data-state={state || undefined}>
                            {mark}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                )),
              )}
              <tr>
                <td className="sheet-name">Other Division</td>
                <td colSpan={editable ? 7 : 6} className="sheet-left muted">
                  {t(editable ? 'iso.av.otherHintEdit' : 'iso.av.otherHint')}
                </td>
                {days.map((d) => {
                  const mark = avOtherMark(d.day, resultDays);
                  const future = d.day > data.today;
                  // Ngày đã có dòng issue thì ✓ này là suy ra, không bấm bỏ được — bỏ thì xoá dòng issue.
                  const clickable = editable && !future && !issueDays.has(d.day);
                  const state = mark ? 'ok' : missed.has(d.day) ? 'missed' : undefined;
                  const label = t('iso.av.otherCell', {
                    day: shortDay(d.day),
                    state: issueDays.has(d.day) ? t('iso.av.dayHasIssue') : clear.has(d.day) ? t('iso.av.dayClear') : t('iso.av.dayBlank'),
                  });
                  return (
                    <td key={d.day} className="sheet-cell" data-future={future ? '' : undefined} data-today={d.day === data.today ? '' : undefined}>
                      {clickable ? (
                        <button
                          type="button"
                          className="sheet-mark"
                          data-state={state}
                          aria-label={label}
                          title={label}
                          disabled={markClear.isPending || unmarkClear.isPending}
                          onClick={() => toggleClear(d.day)}
                        >
                          {mark}
                        </button>
                      ) : (
                        <span className="sheet-mark" data-state={state} title={future ? undefined : label}>
                          {mark}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted small">{t('iso.av.note')}</p>
      </section>

      <IncidentDialogHost me={me} target={dialog} onClose={() => setDialog(null)} />
      {editing ? (
        <IssueDialog
          me={me}
          data={data}
          issue={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast({ message: t(editing === 'new' ? 'iso.av.created' : 'iso.av.updated') });
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

interface IssueForm {
  reportedOn: string;
  divisionId: string;
  newDivisionName: string;
  computerName: string;
  description: string;
  resolvedOn: string;
}

const NEW_DIVISION = '__new__';

function IssueDialog({
  me,
  data,
  issue,
  onClose,
  onSaved,
}: {
  me: Me;
  data: AntivirusGrid;
  issue: AvIssue | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const divisions = useDivisions();
  const firstDay = `${monthKey(data.year, data.month)}-01`;
  const lastDay = daysOf(data.year, data.month).at(-1)?.day ?? firstDay;
  const maxDay = data.today < lastDay ? data.today : lastDay;
  const [form, setForm] = useState<IssueForm>(() => ({
    reportedOn: issue?.reportedOn ?? maxDay,
    divisionId: issue?.divisionId ?? '',
    newDivisionName: '',
    computerName: issue?.computerName ?? '',
    description: issue?.description ?? '',
    resolvedOn: issue?.resolvedOn ?? '',
  }));
  const [error, setError] = useSubmitError([form]);
  const set = <K extends keyof IssueForm>(key: K, value: IssueForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const save = useIsoWrite<IssueForm, AvIssue>(me.csrfToken, (f) => ({
    url: issue ? `/api/v1/iso/antivirus/issues/${issue.id}` : '/api/v1/iso/antivirus/issues',
    method: issue ? 'PATCH' : 'POST',
    body: {
      reportedOn: f.reportedOn,
      divisionId: f.divisionId === NEW_DIVISION ? null : f.divisionId || null,
      newDivisionName: f.divisionId === NEW_DIVISION ? f.newDivisionName.trim() : null,
      computerName: f.computerName.trim(),
      description: f.description.trim(),
      resolvedOn: f.resolvedOn || null,
    },
  }));
  const check = useFormErrors({
    divisionId: !form.divisionId && t('iso.av.divisionRequired'),
    newDivisionName: form.divisionId === NEW_DIVISION && !form.newDivisionName.trim() && t('iso.av.newDivisionRequired'),
    computerName: !form.computerName.trim() && t('iso.av.computerRequired'),
    description: !form.description.trim() && t('iso.av.descriptionRequired'),
    resolvedOn: form.resolvedOn !== '' && form.resolvedOn < form.reportedOn && t('iso.av.resolvedBefore'),
  });
  const options = [
    ...(divisions.data ?? []).filter((d) => d.active || d.id === form.divisionId).map((d) => ({ value: d.id, label: d.name })),
    { value: NEW_DIVISION, label: t('iso.av.newDivision') },
  ];

  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!save.isPending}
      guardUnsaved
      maxWidth={720}
      title={issue ? t('iso.av.editIssue') : t('iso.av.addIssueTitle')}
      footer={
        <>
          <DialogCancel disabled={save.isPending}>{t('common.cancel')}</DialogCancel>
          <SubmitButton form="iso-issue-form" busy={save.isPending} succeeded={save.isSuccess} />
        </>
      }
    >
      <form
        id="iso-issue-form"
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          save.mutate(form, { onSuccess: onSaved, onError: (err) => setError(errorMessage(err)) });
        }}
      >
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
        <FormSection columns={2}>
          <Field label="Reported Date" required htmlFor="iso-av-reported">
            <DatePicker id="iso-av-reported" value={form.reportedOn} min={firstDay} max={maxDay} onChange={(v) => set('reportedOn', v)} />
          </Field>
          <Field label="Division" required hint={t('iso.av.divisionHint')} error={check.error('divisionId')}>
            <Select
              value={form.divisionId}
              ariaLabel="Division"
              placeholder={t('iso.av.pickDivision')}
              options={options}
              searchable
              onChange={(v) => set('divisionId', v)}
            />
          </Field>
          {form.divisionId === NEW_DIVISION ? (
            <Field
              label={t('iso.av.newDivisionName')}
              required
              hint={t('iso.av.newDivisionHint')}
              htmlFor="iso-av-newdiv"
              error={check.error('newDivisionName')}
              span={2}
            >
              <input id="iso-av-newdiv" className="inp" value={form.newDivisionName} onChange={(e) => set('newDivisionName', e.target.value)} />
            </Field>
          ) : null}
          <Field label="Computer Name" required htmlFor="iso-av-pc" error={check.error('computerName')}>
            <input id="iso-av-pc" className="inp mono" value={form.computerName} onChange={(e) => set('computerName', e.target.value)} />
          </Field>
          <Field label="Handled" hint={t('iso.av.handledHint')}>
            <p className="static-value">{issue?.handledBy ?? me.fullName}</p>
          </Field>
          <Field label="Incident Description" required htmlFor="iso-av-desc" error={check.error('description')} span={2}>
            <input id="iso-av-desc" className="inp" value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Resolution Date" hint={t('iso.av.resolvedHint')} htmlFor="iso-av-resolved" error={check.error('resolvedOn')}>
            <DatePicker id="iso-av-resolved" value={form.resolvedOn} min={form.reportedOn} clearable onChange={(v) => set('resolvedOn', v)} />
          </Field>
        </FormSection>
      </form>
    </Dialog>
  );
}
