import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { useConfirm } from '@/ui/confirm-provider';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { HistoryPanel, type HistoryEntry } from '@/ui/history-panel';
import { LoadError, Loading } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { Tabs } from '@/ui/tabs';
import { useToast } from '@/ui/toast';
import { isStepUpCancelled } from '@/ui/use-step-up-retry';
import {
  TREE_KEY,
  historyKey,
  nodeKey,
  publicationsKey,
  versionsKey,
  type CellDiff,
  type DiagramHistoryRow,
  type DiagramNode,
  type GroupDiff,
  type Publications,
  type VersionItem,
} from './diagram-api';

type Run = <T>(action: () => Promise<T>, purpose: string) => Promise<T>;

function historyEntry(row: DiagramHistoryRow, t: TFunction): HistoryEntry {
  const changes = row.changes ?? {};
  const seq = typeof changes.seq === 'number' ? changes.seq : null;
  const base = { id: row.id, at: row.createdAt, actor: row.actor, actorName: row.actorName ?? undefined };
  switch (row.action) {
    case 'created':
      return { ...base, action: t('diagrams.history.created'), detail: typeof changes.name === 'string' ? changes.name : null, tone: 'create' };
    case 'archived':
      return { ...base, action: t('diagrams.history.archived'), tone: 'void' };
    case 'version.saved':
      return { ...base, action: t('diagrams.history.saved', { seq }), detail: String(changes.summary ?? '') };
    case 'version.restored':
      return { ...base, action: t('diagrams.history.restored', { seq }), detail: String(changes.summary ?? ''), tone: 'status' };
    case 'version.published':
      return { ...base, action: t('diagrams.history.published', { seq }), tone: 'status' };
    case 'review.submitted':
      return { ...base, action: t('diagrams.history.submitted', { seq }), detail: typeof changes.reason === 'string' ? changes.reason : null };
    case 'review.returned':
      return { ...base, action: t('diagrams.history.returned'), detail: typeof changes.note === 'string' ? changes.note : null, tone: 'void' };
    case 'review.withdrawn':
      return { ...base, action: t('diagrams.history.withdrawn'), tone: 'void' };
    case 'version.labeled':
      return changes.label
        ? { ...base, action: t('diagrams.history.labeled', { seq }), detail: String(changes.label) }
        : { ...base, action: t('diagrams.history.unlabeled', { seq }) };
    default: {
      const name = changes.name as { before?: unknown; after?: unknown } | undefined;
      return {
        ...base,
        action: t('diagrams.history.updated'),
        detail: name ? `${String(name.before ?? '—')} → ${String(name.after ?? '—')}` : null,
        tone: 'status',
      };
    }
  }
}

/**
 * Phiên bản (mới trước) + lịch sử của một bản vẽ. Danh sách và lịch sử cũng là nội dung bản vẽ
 * (tóm tắt nêu mã thiết bị) nên đi qua `run` — hết ân hạn sơ đồ thì hỏi mã tại chỗ.
 */
export function DiagramVersionsDialog({
  me,
  diagram,
  run,
  onView,
  onRestored,
  onClose,
}: {
  me: Me;
  diagram: DiagramNode;
  run: Run;
  onView: (version: VersionItem) => void;
  onRestored: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const ask = useConfirm();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'versions' | 'history'>('versions');
  const [onlyNamed, setOnlyNamed] = useState(false);
  const [labeling, setLabeling] = useState<VersionItem | null>(null);
  const [details, setDetails] = useState<VersionItem | null>(null);
  const manager = me.role === 'sa' || me.role === 'admin';
  const purpose = t('diagrams.screen.stepUpPurpose', { name: diagram.name });
  const editPurpose = t('diagrams.screen.stepUpEdit', { name: diagram.name });

  const versions = useQuery({
    queryKey: versionsKey(diagram.id),
    queryFn: () => run(() => apiFetch<VersionItem[]>(`/api/v1/diagrams/${diagram.id}/versions`), purpose),
    retry: false,
  });
  const publications = useQuery({
    queryKey: publicationsKey(diagram.id),
    queryFn: () => run(() => apiFetch<Publications>(`/api/v1/diagrams/${diagram.id}/publications`), purpose),
    retry: false,
  });
  const history = useQuery({
    queryKey: historyKey(diagram.id),
    queryFn: () => run(() => apiFetch<DiagramHistoryRow[]>(`/api/v1/diagrams/${diagram.id}/history`), purpose),
    enabled: tab === 'history',
    retry: false,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: versionsKey(diagram.id) }),
      queryClient.invalidateQueries({ queryKey: historyKey(diagram.id) }),
      queryClient.invalidateQueries({ queryKey: TREE_KEY }),
      queryClient.invalidateQueries({ queryKey: nodeKey(diagram.id) }),
      queryClient.invalidateQueries({ queryKey: publicationsKey(diagram.id) }),
    ]);
  };

  /** Lùi bản chính thức một cú bấm: phiên bản MỚI chép bản cũ rồi phát hành nó (Q-23). */
  const restoreOfficial = async (version: VersionItem) => {
    const ok = await ask({
      title: t('diagrams.review.restoreOfficialTitle', { seq: version.seq }),
      message: t('diagrams.review.restoreOfficialMessage', { seq: version.seq }),
      confirmLabel: t('diagrams.review.restoreOfficial'),
    });
    if (!ok) return;
    try {
      const created = await run(
        () =>
          apiFetch<{ seq: number }>(`/api/v1/diagrams/${diagram.id}/versions/${version.id}/restore-official`, {
            method: 'POST',
            csrfToken: me.csrfToken,
          }),
        editPurpose,
      );
      await refresh();
      onRestored();
      toast({ tone: 'ok', message: t('diagrams.review.restoredOfficial', { seq: created.seq }) });
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    }
  };

  const restore = async (version: VersionItem) => {
    const ok = await ask({
      title: t('diagrams.versions.restoreTitle', { seq: version.seq }),
      message: t('diagrams.versions.restoreMessage', { seq: version.seq }),
      confirmLabel: t('diagrams.versions.restore'),
    });
    if (!ok) return;
    try {
      const created = await run(
        () =>
          apiFetch<VersionItem>(`/api/v1/diagrams/${diagram.id}/versions/${version.id}/restore`, {
            method: 'POST',
            csrfToken: me.csrfToken,
          }),
        editPurpose,
      );
      await refresh();
      onRestored();
      toast({ tone: 'ok', message: t('diagrams.versions.restored', { seq: created.seq }) });
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    }
  };

  const list = (versions.data ?? []).filter((v) => !onlyNamed || v.label);
  const latestId = versions.data?.[0]?.id;
  const officialId = publications.data?.officialVersionId ?? null;
  const published = new Set(publications.data?.publishedVersionIds ?? []);

  let versionsBody;
  if (versions.isPending) versionsBody = <Loading />;
  else if (versions.isError) versionsBody = <LoadError error={versions.error} onRetry={() => void versions.refetch()} />;
  else if (list.length === 0) versionsBody = <p className="muted">{t(onlyNamed ? 'diagrams.versions.emptyNamed' : 'diagrams.versions.empty')}</p>;
  else {
    versionsBody = (
      <ul className="tree-list" aria-label={t('diagrams.versions.tabVersions')}>
        {list.map((version) => {
          const canLabel = manager || version.savedBy.toLowerCase() === me.email.toLowerCase();
          return (
            <li key={version.id} className="tree-row">
              <strong>{t('diagrams.versions.seq', { seq: version.seq })}</strong>
              {version.label ? <span className="badge info">{version.label}</span> : null}
              {version.id === latestId ? <span className="badge ok">{t('diagrams.versions.latest')}</span> : null}
              {version.id === officialId ? <span className="badge brand">{t('diagrams.review.official')}</span> : null}
              {version.id !== officialId && published.has(version.id) ? (
                <span className="badge outline">{t('diagrams.review.wasOfficial')}</span>
              ) : null}
              {version.restoredFromSeq ? (
                <span className="badge outline">{t('diagrams.versions.restoredFrom', { seq: version.restoredFromSeq })}</span>
              ) : null}
              <span className="muted">
                {t('diagrams.versions.by', { at: formatDateTime(version.savedAt), by: version.savedByName ?? version.savedBy })}
              </span>
              <span className="tree-summary">{version.summary}</span>
              <span className="tree-actions row">
                <button type="button" className="btn sm" aria-label={t('diagrams.versions.viewOf', { seq: version.seq })} onClick={() => onView(version)}>
                  {t('diagrams.versions.view')}
                </button>
                <button type="button" className="btn sm" aria-label={t('diagrams.versions.detailsOf', { seq: version.seq })} onClick={() => setDetails(version)}>
                  {t('diagrams.versions.details')}
                </button>
                {canLabel ? (
                  <button type="button" className="btn sm" aria-label={t('diagrams.versions.nameOf', { seq: version.seq })} onClick={() => setLabeling(version)}>
                    {t('diagrams.versions.name')}
                  </button>
                ) : null}
                {manager && version.id !== latestId ? (
                  <button type="button" className="btn sm" aria-label={t('diagrams.versions.restoreOf', { seq: version.seq })} onClick={() => void restore(version)}>
                    {t('diagrams.versions.restore')}
                  </button>
                ) : null}
                {manager && version.id !== officialId && published.has(version.id) ? (
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={t('diagrams.review.restoreOfficialOf', { seq: version.seq })}
                    onClick={() => void restoreOfficial(version)}
                  >
                    {t('diagrams.review.restoreOfficial')}
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  let historyBody;
  if (history.isPending) historyBody = <Loading />;
  else if (history.isError) historyBody = <LoadError error={history.error} onRetry={() => void history.refetch()} />;
  else historyBody = <HistoryPanel entries={history.data.map((row) => historyEntry(row, t))} emptyText={t('diagrams.history.empty')} />;

  return (
    <>
      <Dialog open onOpenChange={onClose} maxWidth={760} title={t('diagrams.versions.title')} initialFocus="title">
        <Tabs
          ariaLabel={t('diagrams.versions.tabsLabel')}
          value={tab}
          onChange={(key) => setTab(key === 'history' ? 'history' : 'versions')}
          items={[
            { key: 'versions', label: t('diagrams.versions.tabVersions') },
            { key: 'history', label: t('diagrams.versions.tabHistory') },
          ]}
        />
        {tab === 'versions' ? (
          <>
            <label className="row">
              <input type="checkbox" checked={onlyNamed} onChange={(event) => setOnlyNamed(event.target.checked)} />
              {t('diagrams.versions.onlyNamed')}
            </label>
            {versionsBody}
          </>
        ) : (
          historyBody
        )}
      </Dialog>
      {labeling ? (
        <LabelDialog
          me={me}
          diagramId={diagram.id}
          version={labeling}
          run={run}
          purpose={editPurpose}
          onSaved={async () => {
            await refresh();
            toast({ tone: 'ok', message: t('diagrams.versions.labelSaved', { seq: labeling.seq }) });
            setLabeling(null);
          }}
          onClose={() => setLabeling(null)}
        />
      ) : null}
      {details ? <ChangesDialog diagramId={diagram.id} version={details} run={run} purpose={purpose} onClose={() => setDetails(null)} /> : null}
    </>
  );
}

function LabelDialog({
  me,
  diagramId,
  version,
  run,
  purpose,
  onSaved,
  onClose,
}: {
  me: Me;
  diagramId: string;
  version: VersionItem;
  run: Run;
  purpose: string;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [label, setLabel] = useState(version.label ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await run(
        () =>
          apiFetch(`/api/v1/diagrams/${diagramId}/versions/${version.id}/label`, {
            method: 'POST',
            csrfToken: me.csrfToken,
            body: JSON.stringify({ label: label.trim() ? label.trim() : null }),
          }),
        purpose,
      );
      await onSaved();
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!busy}
      maxWidth={440}
      initialFocus="first-field"
      title={t('diagrams.versions.labelTitle', { seq: version.seq })}
      footer={
        <>
          <DialogCancel>{t('diagrams.form.cancel')}</DialogCancel>
          <button type="submit" form="diagram-label-form" className="btn primary" disabled={busy}>
            {t('diagrams.versions.labelSave')}
          </button>
        </>
      }
    >
      <form
        id="diagram-label-form"
        className="form-grid"
        data-columns={1}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t('diagrams.versions.labelField')} hint={t('diagrams.versions.labelHint')}>
          <input className="inp" value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

function ChangeGroup({ title, group }: { title: string; group: GroupDiff }) {
  const { t } = useTranslation();
  const rows: [string, GroupDiff['added']][] = [
    [t('diagrams.versions.added'), group.added],
    [t('diagrams.versions.removed'), group.removed],
    [t('diagrams.versions.changed'), group.changed],
  ];
  if (rows.every(([, items]) => items.length === 0)) return null;
  return (
    <section>
      <h3>{title}</h3>
      <dl>
        {rows
          .filter(([, items]) => items.length > 0)
          .map(([verb, items]) => (
            <div key={verb}>
              <dt>
                {verb} ({items.length})
              </dt>
              <dd>{items.map((item) => item.label).join(', ')}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}

function ChangesDialog({
  diagramId,
  version,
  run,
  purpose,
  onClose,
}: {
  diagramId: string;
  version: VersionItem;
  run: Run;
  purpose: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const changes = useQuery({
    queryKey: ['diagram-changes', diagramId, version.id],
    queryFn: () => run(() => apiFetch<CellDiff>(`/api/v1/diagrams/${diagramId}/versions/${version.id}/changes`), purpose),
    retry: false,
  });
  let body;
  if (changes.isPending) body = <Loading />;
  else if (changes.isError) body = <LoadError error={changes.error} onRetry={() => void changes.refetch()} />;
  else {
    const groups = [
      <ChangeGroup key="d" title={t('diagrams.versions.groupDevices')} group={changes.data.devices} />,
      <ChangeGroup key="e" title={t('diagrams.versions.groupEdges')} group={changes.data.edges} />,
      <ChangeGroup key="s" title={t('diagrams.versions.groupShapes')} group={changes.data.shapes} />,
    ];
    const empty = [changes.data.devices, changes.data.edges, changes.data.shapes].every(
      (g) => g.added.length + g.removed.length + g.changed.length === 0,
    );
    body = empty ? <p className="muted">{t('diagrams.versions.noChanges')}</p> : groups;
  }
  return (
    <Dialog open onOpenChange={onClose} maxWidth={560} initialFocus="title" title={t('diagrams.versions.detailsTitle', { seq: version.seq })}>
      <p>{version.summary}</p>
      {body}
    </Dialog>
  );
}
