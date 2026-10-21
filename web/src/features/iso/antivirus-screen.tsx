import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
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
import { ISO_KEY, useAntivirusGrid, useDivisions, useIsoWrite, useOwners } from './iso-api';
import { LockedBanner, MonthNav, OwnerNotice, PeriodStateBadge } from './iso-parts';
import {
  avIssueMark,
  avMarkIndex,
  avMarkOf,
  avOtherMark,
  daysOf,
  groupByDivision,
  monthKey,
  nextTick,
  parseMonthParam,
  shortDay,
} from './iso-rules';
import { useTickQueue } from './use-tick-queue';
import { IncidentDialogHost, type IncidentDialogTarget } from './incident-dialog';
import type { AntivirusGrid, AvIssue, IncidentCell, TickResult } from './iso-types';
import { CodeInput } from '@/ui/code-input';
import { InfoTip } from '@/ui/info-tip';

/**
 * Lưới 0208 — Theo dõi antivirus. Dòng issue (một máy × một ngày phát hiện) gom theo bộ phận, chỉ bộ
 * phận có issue trong tháng mới hiện; "Other Division" luôn ở cuối và tick tay mỗi ngày — ngày chỉ
 * có kết quả khi dòng này đã ✓. Ô dòng máy bấm như 0203; ô chưa bấm hiện theo Other Division
 * (Q-28, bấm từng dòng). Màn nhập — desktop.
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
  const [markingAll, setMarkingAll] = useState(false);
  const queryClient = useQueryClient();
  const days = daysOf(data.year, data.month);
  const groups = useMemo(() => groupByDivision(data.issues), [data.issues]);
  const index = useMemo(() => avMarkIndex(data.clearDays, data.marks), [data.clearDays, data.marks]);
  const clear = index.clear;
  const missed = new Set(data.summary.missedDays);
  const todayPending = data.summary.pendingDays.includes(data.today);
  const open = data.state === 'open';
  const editable = open && data.canEdit;

  const markClear = useIsoWrite<{ day: string }>(me.csrfToken, (body) => ({ url: '/api/v1/iso/antivirus/clear-days', method: 'POST', body }));
  const unmarkClear = useIsoWrite<{ day: string }>(me.csrfToken, ({ day }) => ({ url: `/api/v1/iso/antivirus/clear-days/${day}`, method: 'DELETE' }));
  const removeIssue = useIsoWrite<{ id: string }>(me.csrfToken, ({ id }) => ({ url: `/api/v1/iso/antivirus/issues/${id}`, method: 'DELETE' }));
  const fail = (err: unknown) => toast({ message: errorMessage(err), tone: 'error' });
  const queue = useTickQueue(me.csrfToken, '0208', monthKey(data.year, data.month), { onSaved: () => undefined, onError: fail });
  /** Dấu bấm tay của ô, tính cả lần bấm chưa lưu xong. */
  const explicit = (issue: AvIssue, day: string): TickResult | null => {
    const key = `${issue.id}|${day}`;
    return queue.pending.has(key) ? (queue.pending.get(key) ?? null) : avMarkOf(issue, day, index);
  };
  const shownMark = (issue: AvIssue, day: string): '' | '✓' | '✗' => {
    if (day === issue.reportedOn) return '✗';
    const mark = explicit(issue, day);
    if (mark) return mark === 'ok' ? '✓' : '✗';
    return avIssueMark(issue, day, index);
  };
  // Ô đang ✓ theo Other Division coi như đã ✓: bấm là sang ✗, bấm tiếp về lại ✓ theo Other.
  const pressIssueCell = (issue: AvIssue, day: string) => {
    const current = explicit(issue, day) ?? (clear.has(day) ? 'ok' : null);
    queue.set(issue.id, day, nextTick(current));
  };
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
    setMarkingAll(true);
    // Ghi lần lượt rồi làm mới MỘT lần ở cuối — qua `useIsoWrite` thì mỗi ngày kéo theo một lượt
    // làm mới cả nhánh phiếu. Hỏng giữa chừng: các ngày trước đó đã lưu, lưới làm mới cho thấy đúng.
    try {
      for (const day of data.summary.missedDays) {
        await apiFetch('/api/v1/iso/antivirus/clear-days', { method: 'POST', csrfToken: me.csrfToken, body: JSON.stringify({ day }) });
      }
      toast({ message: t('iso.av.markedAll', { count: data.summary.missedDays.length }) });
    } catch (err) {
      fail(err);
    } finally {
      setMarkingAll(false);
      void queryClient.invalidateQueries({ queryKey: ISO_KEY });
    }
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
          <div className="chip-row">
            {data.summary.missedDays.length > 1 ? (
              <button type="button" className="btn sm" disabled={markingAll || markClear.isPending} onClick={() => void markAllPast()}>
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
          {/* Cách ghi + ghi chú phiếu vào (i) (TX-14). */}
          <div className="page-header-title">
            <h2 id="iso-av-grid">{t('iso.grid')}</h2>
            <InfoTip subject={t('iso.grid')}>
              <p>{t('iso.av.recordHint')}</p>
              <p>{t('iso.av.note')}</p>
            </InfoTip>
          </div>
          <span className="muted small">
            {t('iso.av.summary', { issues: data.issues.length, divisions: groups.length, missed: data.summary.missedDays.length })}
          </span>
        </div>
        {/* Lưới rộng hơn màn: vùng cuộn phải vào được bằng bàn phím (AX-07). */}
        <div className="sheet-scroll" tabIndex={0} role="region" aria-label={t('iso.field.tab0208')}>
          <table className="sheet-grid">
            <thead>
              <tr>
                <th scope="col" className="sheet-name">
                  {t('iso.field.division')}
                </th>
                <th scope="col">{t('iso.field.reportedDate')}</th>
                <th scope="col">{t('iso.field.computerName')}</th>
                <th scope="col" className="sheet-left">
                  {t('iso.field.incidentDescription')}
                </th>
                <th scope="col">{t('iso.field.resolutionDate')}</th>
                <th scope="col">{t('iso.field.handled')}</th>
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
                      ) : editable ? (
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
                      const mark = shownMark(issue, d.day);
                      const reported = d.day === issue.reportedOn;
                      const future = d.day > data.today;
                      const state =
                        mark === '✗' ? (reported && issue.incident ? 'fail-linked' : 'fail') : mark === '✓' ? 'ok' : missed.has(d.day) ? 'missed' : '';
                      const label = t('iso.av.issueCell', {
                        name: issue.computerName,
                        day: shortDay(d.day),
                        state: reported
                          ? t('iso.av.cellReported')
                          : mark === '✗'
                            ? t('iso.av.cellFail')
                            : mark === '✓'
                              ? explicit(issue, d.day)
                                ? t('iso.av.dayClear')
                                : t('iso.av.cellOtherOk')
                              : t('iso.av.dayBlank'),
                      });
                      return (
                        <td key={d.day} className="sheet-cell" data-future={future ? '' : undefined} data-today={d.day === data.today ? '' : undefined}>
                          {editable && !future && !reported ? (
                            <button
                              type="button"
                              className="sheet-mark"
                              data-state={state || undefined}
                              aria-label={label}
                              title={label}
                              onClick={() => pressIssueCell(issue, d.day)}
                            >
                              {mark}
                            </button>
                          ) : (
                            <span className="sheet-mark" data-state={state || undefined} title={future ? undefined : label}>
                              {mark}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                )),
              )}
              <tr>
                <td className="sheet-name">{t('iso.field.otherDivision')}</td>
                <td colSpan={editable ? 7 : 6} className="sheet-left muted">
                  {t(editable ? 'iso.av.otherHintEdit' : 'iso.av.otherHint')}
                </td>
                {days.map((d) => {
                  const mark = avOtherMark(d.day, index);
                  const future = d.day > data.today;
                  const clickable = editable && !future;
                  const state = mark ? 'ok' : missed.has(d.day) ? 'missed' : undefined;
                  const label = t('iso.av.otherCell', {
                    day: shortDay(d.day),
                    state: clear.has(d.day) ? t('iso.av.dayClear') : t('iso.av.dayBlank'),
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
          <Field label={t('iso.field.reportedDate')} required htmlFor="iso-av-reported">
            <DatePicker id="iso-av-reported" value={form.reportedOn} min={firstDay} max={maxDay} onChange={(v) => set('reportedOn', v)} />
          </Field>
          <Field label={t('iso.field.division')} required hint={t('iso.av.divisionHint')} error={check.error('divisionId')}>
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
          <Field label={t('iso.field.computerName')} required htmlFor="iso-av-pc" error={check.error('computerName')}>
            <CodeInput id="iso-av-pc" value={form.computerName} onChange={(e) => set('computerName', e.target.value)} />
          </Field>
          <Field label={t('iso.field.handled')} hint={t('iso.av.handledHint')}>
            {/* Dòng cũ chưa có Handled thì để trống: API không ghi lại khi sửa, hiện tên người đang
                sửa ở đây là hứa một thứ phiếu in sẽ không có. */}
            <p className="static-value">{issue ? (issue.handledBy ?? '—') : me.fullName}</p>
          </Field>
          <Field label={t('iso.field.incidentDescription')} required htmlFor="iso-av-desc" error={check.error('description')} span={2}>
            <input id="iso-av-desc" className="inp" value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label={t('iso.field.resolutionDate')} hint={t('iso.av.resolvedHint')} htmlFor="iso-av-resolved" error={check.error('resolvedOn')}>
            <DatePicker id="iso-av-resolved" value={form.resolvedOn} min={form.reportedOn} clearable onChange={(v) => set('resolvedOn', v)} />
          </Field>
        </FormSection>
      </form>
    </Dialog>
  );
}
