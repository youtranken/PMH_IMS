import { useEffect, useMemo, useState } from 'react';
import type { Me } from '@/lib/me';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { todayIso } from '@/lib/format';
import { PATHS } from '@/lib/routes';
import { ChipToggleGroup } from '@/ui/chip-toggle-group';
import { DataTable } from '@/ui/data-table';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { SegmentedRadio } from '@/ui/segmented-radio';
import { Select } from '@/ui/select';
import { useIncidentList, useLinkable } from './iso-api';
import { IncidentDialogHost, cellKey, type IncidentDialogTarget } from './incident-dialog';
import { KIND_LABEL } from './iso-paper';
import { monthKey, shortDay, toVnParts } from './iso-rules';
import { INCIDENT_KINDS, INCIDENT_STATUS_TONE, type Incident, type UnlinkedCell } from './iso-types';

const STATUS_LABEL: Record<string, string> = { temporary_fix: 'Temporary Fix', resolved: 'Resolved', in_progress: 'In Progress' };

type Source = 'backup' | 'antivirus' | 'direct';

function sourceOf(incident: Incident): Source {
  if (incident.cells.some((c) => c.form === '0203')) return 'backup';
  if (incident.cells.some((c) => c.form === '0208')) return 'antivirus';
  return 'direct';
}

function stamp(iso: string | null): string {
  if (!iso) return '…';
  const { date, time } = toVnParts(iso);
  return `${shortDay(date)} ${time}`;
}

/**
 * Danh sách 0206 — màn ĐỌC, chạy ở 390px. Trên cùng là ô ✗ chưa có phiếu (của 0203 và
 * 0208); bảng phiếu chọn năm trước (mặc định năm nay), rồi lọc tháng, loại, nguồn, bản ký.
 */
export function IncidentsScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => todayIso());
  const thisYear = Number(today.slice(0, 4));
  const year = Number(params.get('year')) || thisYear;
  const month = params.get('month') ?? '';
  const kind = params.get('kind') ?? '';
  const source = (params.get('source') ?? '') as Source | '';
  const signed = params.get('signed') ?? '';
  const query = new URLSearchParams({ year: String(year) });
  if (month) query.set('month', month);
  if (kind) query.set('kind', kind);
  if (source) query.set('source', source);
  if (signed) query.set('signed', signed);
  const list = useIncidentList(query.toString());
  const [dialog, setDialog] = useState<IncidentDialogTarget | null>(null);

  // Link sâu cũ `/iso/incidents/new?cell=…` (mail, dấu trang) về đây với `?new=1`: mở hộp lập
  // phiếu, điền sẵn ô nếu ô đó còn chưa có phiếu, rồi bỏ tham số để F5 không mở lại.
  const linkable = useLinkable();
  const wantsNew = params.get('new') === '1';
  const wantedCell = params.get('cell');
  useEffect(() => {
    if (!wantsNew || (wantedCell && !linkable.data && !linkable.isError)) return;
    setDialog({ cell: wantedCell ? (linkable.data?.find((c) => cellKey(c) === wantedCell) ?? null) : null });
    const next = new URLSearchParams(params);
    next.delete('new');
    next.delete('cell');
    setParams(next, { replace: true });
  }, [wantsNew, wantedCell, linkable.data, linkable.isError, params, setParams]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const columns = useMemo<ColumnDef<Incident, unknown>[]>(
    () => [
      {
        id: 'code',
        header: t('iso.incidents.code'),
        cell: ({ row }) => (
          <Link className="mono" to={PATHS.isoIncident(row.original.id)}>
            {row.original.code}
          </Link>
        ),
      },
      {
        id: 'source',
        header: t('iso.incidents.source'),
        cell: ({ row }) => <SourceCell incident={row.original} />,
      },
      { id: 'kind', header: t('iso.incidents.kind'), cell: ({ row }) => <span className="badge outline">{KIND_LABEL[row.original.kind]}</span> },
      {
        id: 'range',
        header: t('iso.incidents.range'),
        cell: ({ row }) => `${stamp(row.original.detectedAt)} → ${stamp(row.original.resolvedAt)}`,
      },
      {
        id: 'status',
        header: t('iso.incidents.status'),
        cell: ({ row }) => <span className={`badge ${INCIDENT_STATUS_TONE[row.original.status]}`}>{STATUS_LABEL[row.original.status]}</span>,
      },
      { id: 'by', header: t('iso.incidents.by'), cell: ({ row }) => row.original.createdByName },
      {
        id: 'signed',
        header: t('iso.incidents.signed'),
        cell: ({ row }) =>
          row.original.signedCurrent ? (
            <span className="badge ok">{t('iso.incidents.signedYes')}</span>
          ) : (
            <span className="badge muted">{row.original.locked ? t('iso.incidents.signedNo') : t('iso.incidents.notLocked')}</span>
          ),
      },
      {
        id: 'period',
        header: t('iso.incidents.period'),
        cell: ({ row }) => (
          <Link to={PATHS.isoPeriod(row.original.governing[0], monthKey(row.original.year, row.original.month))}>
            {`${String(row.original.month).padStart(2, '0')}/${row.original.year}`}
          </Link>
        ),
      },
    ],
    [t],
  );

  const items = list.data?.items ?? [];
  const unlinked = list.data?.unlinked ?? [];

  return (
    <>
      <PageHeader
        title={t('nav.isoIncidents')}
        subtitle={t('iso.incidents.subtitle')}
        actions={
          <button type="button" className="btn primary" onClick={() => setDialog({ cell: null })}>
            {t('iso.incidents.add')}
          </button>
        }
      />
      {unlinked.length > 0 ? <UnlinkedList cells={unlinked} onCreate={(cell) => setDialog({ cell })} /> : null}
      <section className="filter-bar" aria-label={t('iso.incidents.filters')}>
        <SegmentedRadio
          label={t('iso.incidents.year')}
          value={String(year)}
          options={[...new Set([year, thisYear - 1, thisYear])].sort().map((y) => ({ value: String(y), label: String(y) }))}
          onChange={(v) => setParam('year', v === String(thisYear) ? '' : v)}
        />
        <Select
          value={month}
          ariaLabel={t('iso.incidents.month')}
          placeholder={t('iso.incidents.allMonths')}
          options={[
            { value: '', label: t('iso.incidents.allMonths') },
            ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: t('iso.incidents.monthN', { n: i + 1 }) })),
          ]}
          onChange={(v) => setParam('month', v)}
        />
        <Select
          value={kind}
          ariaLabel={t('iso.incidents.kind')}
          placeholder={t('iso.incidents.allKinds')}
          options={[{ value: '', label: t('iso.incidents.allKinds') }, ...INCIDENT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))]}
          onChange={(v) => setParam('kind', v)}
        />
        <ChipToggleGroup
          label={t('iso.incidents.source')}
          allLabel={t('iso.incidents.allSources')}
          options={[
            { value: 'backup', label: '0203' },
            { value: 'antivirus', label: '0208' },
            { value: 'direct', label: t('iso.incidents.direct') },
          ]}
          value={source ? [source] : []}
          onChange={(next) => setParam('source', next.at(-1) ?? '')}
        />
        <Select
          value={signed}
          ariaLabel={t('iso.incidents.signed')}
          placeholder={t('iso.incidents.signedAny')}
          options={[
            { value: '', label: t('iso.incidents.signedAny') },
            { value: 'yes', label: t('iso.incidents.signedYes') },
            { value: 'no', label: t('iso.incidents.signedNo') },
          ]}
          onChange={(v) => setParam('signed', v)}
        />
      </section>
      {list.isLoading ? (
        <Loading variant="table" />
      ) : list.isError ? (
        <LoadError error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={t('iso.incidents.empty', { year })} hint={t('iso.incidents.emptyHint')} />
      ) : (
        <DataTable
          data={items}
          columns={columns}
          emptyText={t('iso.incidents.empty', { year })}
          stackOnMobile
          mobileCard={{
            title: (row) => row.code,
            titleIsCode: true,
            href: (row) => PATHS.isoIncident(row.id),
            badge: (row) => <span className={`badge ${INCIDENT_STATUS_TONE[row.status]}`}>{STATUS_LABEL[row.status]}</span>,
            subtitle: (row) => <SourceCell incident={row} />,
            meta: (row) => [KIND_LABEL[row.kind], `${stamp(row.detectedAt)} → ${stamp(row.resolvedAt)}`, row.createdByName].join(' · '),
            aside: (row) =>
              row.signedCurrent ? <span className="badge ok">{t('iso.incidents.signedYes')}</span> : null,
          }}
        />
      )}
      <IncidentDialogHost me={me} target={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

function SourceCell({ incident }: { incident: Incident }) {
  const { t } = useTranslation();
  const source = sourceOf(incident);
  if (source === 'direct') return <span className="muted">{t('iso.incidents.direct')}</span>;
  const cells = incident.cells.filter((c) => c.form === (source === 'backup' ? '0203' : '0208'));
  return (
    <>
      <span className="badge outline">{source === 'backup' ? '0203' : '0208'}</span> <strong>{cells[0]?.label}</strong>
      <span className="cell-sub">{cells.map((c) => shortDay(c.day)).join(', ')}</span>
    </>
  );
}

function UnlinkedList({ cells, onCreate }: { cells: UnlinkedCell[]; onCreate: (cell: UnlinkedCell) => void }) {
  const { t } = useTranslation();
  return (
    <section className="card" aria-label={t('iso.incidents.needIncident')}>
      <h2>{t('iso.incidents.needIncident')}</h2>
      <ul className="sheet-checks">
        {cells.map((c) => (
          <li key={c.form === '0203' ? `${c.lineId}|${c.day}` : c.issueId}>
            <span className="sheet-mark" data-state="fail">
              ✗
            </span>
            <span>
              <strong>
                {c.form} · {c.label} · {shortDay(c.day)}
              </strong>{' '}
              <button type="button" className="btn sm ghost" onClick={() => onCreate(c)}>
                {t('iso.createIncident')}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
