import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { BREAKPOINTS } from '@/ui/breakpoints';
import { useConfirm } from '@/ui/confirm-provider';
import { Crumbs, type Crumb } from '@/ui/detail-header';
import { Dialog } from '@/ui/dialog';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import type { RowAction } from '@/ui/row-actions';
import { ScrollX } from '@/ui/scroll-x';
import { SegmentedRadio } from '@/ui/segmented-radio';
import { StepList } from '@/ui/step-list';
import { useToast } from '@/ui/toast';
import { useDebouncedValue } from '@/ui/use-debounced-value';
import { useMediaQuery } from '@/ui/use-media-query';
import { useIsNarrow } from '@/ui/use-narrow';
import { useNow } from '@/ui/use-now';
import { useStepUpRetry } from '@/ui/use-step-up-retry';
import { TREE_KEY, type DiagramNode, type FoundDevice } from './diagram-api';
import { slideOrder } from './diagram-tree';
import { buildMap, canPurge, filterActive, nodeMatches, resolveSelection, TODO_KINDS, todoCounts, type MapFilter, type TodoKind } from './diagram-map';
import { DiagramArchivedSection, useArchivedDiagrams } from './diagram-archived';
import { DiagramListView, DiagramMapView } from './diagram-map-view';
import { DiagramNodeDialog } from './diagram-node-dialog';
import { DiagramPanel } from './diagram-panel';
import { canManageNode } from './diagram-presentation';
import { enterFullscreen } from './diagram-slideshow';
import { useDiagramPrune } from './use-diagram-prune';

type Editing = { parent: DiagramNode | null } | { node: DiagramNode } | null;

/** Nhịp làm mới chữ "2 giờ trước". */
const AGO_TICK_MS = 60_000;
/** Ô tìm hỏi server "máy này nằm ở bản vẽ nào" từ 2 ký tự — như ô tìm trên trình xem. */
const DEVICE_SEARCH_MIN = 2;

const TODO_TONE: Record<TodoKind, string> = { drafts: 'warn', pending: 'info', drift: 'danger' };

/**
 * Màn /diagrams — "bản đồ không gian" (Q-23): bản vẽ gốc là băng tối, con là khu, cháu là ô; dải
 * "Cần làm" lọc theo việc; bấm ô mở panel (desktop bên phải, màn hẹp thành hộp toàn màn). Mọi
 * trạng thái nằm trong URL — `?node=` chọn, `?root=` đi sâu, `?todo=` / `?q=` lọc, `?view=list` —
 * nên mở lại link vẫn đúng chỗ. Chỉ tên / trạng thái / số đếm: xem bản đồ không cần mã.
 */
export function DiagramTreeScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const ask = useConfirm();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const narrow = useIsNarrow();
  const noEditor = useMediaQuery(BREAKPOINTS.editor);
  const now = useNow(AGO_TICK_MS);
  const [editing, setEditing] = useState<Editing>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const stepUp = useStepUpRetry(me.csrfToken);
  const tree = useQuery({ queryKey: TREE_KEY, queryFn: () => apiFetch<DiagramNode[]>('/api/v1/diagrams') });
  const all = useMemo(() => tree.data ?? [], [tree.data]);
  const archived = useArchivedDiagrams();
  const archivedCount = archived.data?.length ?? 0;
  const showArchived = params.get('archived') === '1';

  const rawTodo = params.get('todo');
  const filter: MapFilter = {
    todo: TODO_KINDS.includes(rawTodo as TodoKind) ? (rawTodo as TodoKind) : null,
    q: params.get('q') ?? '',
  };
  const view = params.get('view') === 'list' ? 'list' : 'map';
  const selected = resolveSelection(all, params.get('node'));
  const selectedNode = all.find((n) => n.id === selected) ?? null;
  const map = useMemo(() => buildMap(all, params.get('root')), [all, params]);
  const counts = todoCounts(all);

  const update = (changes: Record<string, string | null>, replace = true) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace },
    );
  const hrefWith = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const text = next.toString();
    return text ? `?${text}` : '?';
  };

  const select = (id: string | null) => {
    update({ node: id });
    if (narrow && id) setSheetOpen(true);
  };
  // Đi sâu là một bước "Back" được: trình duyệt quay lại đúng tầng trước.
  const drill = (id: string) => update({ root: id, node: id }, false);

  const debouncedQ = useDebouncedValue(filter.q.trim());
  const devices = useQuery({
    queryKey: ['diagrams-find', debouncedQ],
    queryFn: () => apiFetch<FoundDevice[]>(`/api/v1/diagrams/find?${new URLSearchParams({ q: debouncedQ }).toString()}`),
    enabled: debouncedQ.length >= DEVICE_SEARCH_MIN,
    retry: false,
  });

  const prune = useDiagramPrune(me, stepUp.run, (node) => {
    if (node.id === selected) update({ node: node.parentId });
  });

  const archive = async (node: DiagramNode) => {
    const ok = await ask({
      title: t('diagrams.archiveTitle', { name: node.name }),
      message: t('diagrams.archiveMessage'),
      confirmLabel: t('diagrams.archive'),
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/v1/diagrams/${node.id}/archive`, { method: 'POST', csrfToken: me.csrfToken });
      await queryClient.invalidateQueries({ queryKey: TREE_KEY });
      toast({ tone: 'ok', message: t('diagrams.archived', { name: node.name }) });
      if (node.id === selected) update({ node: node.parentId });
    } catch (error) {
      toast({ tone: 'error', message: errorMessage(error) });
    }
  };

  const actionsOf = (node: DiagramNode): RowAction[] => {
    const items: RowAction[] = [];
    if (node.kind !== 'presentation') {
      // Nhánh chưa phát hành bản nào thì trình chiếu chỉ ra màn trống: tắt kèm lý do (D-06).
      const nothingToShow = slideOrder(all, node.id).length === 0;
      items.push({
        key: 'present',
        label: t('diagrams.slideshow.start'),
        disabled: nothingToShow,
        hint: nothingToShow ? t('diagrams.slideshow.nothing') : undefined,
        // Toàn màn hình phải xin ngay trong cú bấm (trình duyệt chặn nếu xin sau khi chuyển trang).
        onSelect: () => {
          enterFullscreen();
          navigate(PATHS.diagramPresent(node.id));
        },
      });
      items.push({ key: 'child', label: t('diagrams.addChild'), onSelect: () => setEditing({ parent: node }) });
    }
    if (canManageNode(node, me)) {
      items.push({
        key: 'edit',
        label: node.kind === 'presentation' ? t('diagrams.presentation.rename') : t('diagrams.edit'),
        onSelect: () => setEditing({ node }),
      });
      items.push({ key: 'archive', label: t('diagrams.archive'), warn: true, onSelect: () => void archive(node) });
    }
    if (canPurge(node, all, me)) {
      items.push({ key: 'purge', label: t('diagrams.prune.purge'), hint: t('diagrams.prune.purgeHint'), danger: true, onSelect: () => void prune.purge(node) });
    }
    return items;
  };

  const panel = selectedNode ? (
    <DiagramPanel
      me={me}
      node={selectedNode}
      nodes={all}
      run={stepUp.run}
      canEdit={!noEditor}
      actions={actionsOf(selectedNode)}
      onSelect={(id) => update({ node: id })}
      discard={prune.discard}
    />
  ) : null;

  let body;
  if (tree.isPending) body = <Loading />;
  else if (tree.isError) body = <LoadError error={tree.error} onRetry={() => void tree.refetch()} />;
  else if (all.length === 0) {
    // Màn trống nói luôn cả lộ trình, không chỉ bước đầu: người mới mở không biết bản đồ dùng thế nào.
    body = (
      <>
        <div className="card">
          <EmptyState title={t('diagrams.emptyTitle')} hint={t('diagrams.emptyHint')} />
          <StepList
            label={t('diagrams.stepsLabel')}
            steps={[t('diagrams.treeSteps.root'), t('diagrams.treeSteps.child'), t('diagrams.treeSteps.open'), t('diagrams.treeSteps.publish')]}
          />
        </div>
        {/* Mọi bản đều đã cất thì cây trống, nhưng bản đã cất vẫn phải tìm lại được. */}
        {archivedCount > 0 ? <DiagramArchivedSection me={me} live={all} archived={archived} /> : null}
      </>
    );
  } else {
    const crumbs: Crumb[] =
      map.path.length > 0
        ? [
            { label: t('diagrams.map.allRoots'), to: hrefWith({ root: null }) },
            ...map.path.map((n, index) => (index === map.path.length - 1 ? { label: n.name } : { label: n.name, to: hrefWith({ root: n.id }) })),
          ]
        : [];
    const filtering = filterActive(filter);
    const matched = filtering ? all.filter((n) => nodeMatches(n, filter)).length : 0;
    const q = filter.q.trim();
    body = (
      <>
        <div className="dmap-toolbar">
          <ScrollX ariaLabel={t('diagrams.map.todoLabel')} className="dmap-todo">
            {TODO_KINDS.some((kind) => counts[kind] > 0) ? (
              TODO_KINDS.filter((kind) => counts[kind] > 0).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="dmap-todo-chip"
                  data-tone={TODO_TONE[kind]}
                  aria-pressed={filter.todo === kind}
                  onClick={() => update({ todo: filter.todo === kind ? null : kind })}
                >
                  <span className="dmap-dot" aria-hidden="true" />
                  {t(`diagrams.map.todo_${kind}`, { count: counts[kind] })}
                </button>
              ))
            ) : (
              <span className="muted">{t('diagrams.map.todoNone')}</span>
            )}
          </ScrollX>
          {/* Bản đã cất rời bản đồ nhưng phải xem lại được (Q-23); không có bản nào thì không bày nút. */}
          {archivedCount > 0 || showArchived ? (
            <button
              type="button"
              className="dmap-todo-chip dmap-archived-toggle"
              aria-pressed={showArchived}
              onClick={() => update({ archived: showArchived ? null : '1' })}
            >
              {t('diagrams.archivedList.toggle', { count: archivedCount })}
            </button>
          ) : null}
        </div>
        {filtering ? (
          <p className="dmap-filtering" role="status">
            {t('diagrams.map.filtering', { count: matched })}{' '}
            <button type="button" className="linkbtn" onClick={() => update({ todo: null, q: null })}>
              {t('diagrams.map.clearFilter')}
            </button>
          </p>
        ) : null}
        {q.length >= DEVICE_SEARCH_MIN && devices.data ? (
          <section className="dmap-found" aria-label={t('diagrams.map.devicesFound', { q })}>
            {devices.data.length === 0 ? (
              <p className="muted">{t('diagrams.map.devicesNone', { q })}</p>
            ) : (
              <ul className="dmap-chips">
                {devices.data.flatMap((device) =>
                  device.diagrams.length === 0
                    ? [
                        <li key={device.id} className="muted">
                          {t('diagrams.map.deviceNotDrawn', { code: device.code })}
                        </li>,
                      ]
                    : device.diagrams.map((diagram) => (
                        <li key={`${device.id}-${diagram.id}`}>
                          <Link className="dmap-chip" to={`${PATHS.diagram(diagram.id)}?${new URLSearchParams({ focus: device.id }).toString()}`}>
                            {t('diagrams.map.deviceIn', { code: device.code, diagram: diagram.name })}
                          </Link>
                        </li>
                      )),
                )}
              </ul>
            )}
          </section>
        ) : null}
        <div className="dmap-layout">
          <div className="dmap-main">
            {crumbs.length > 0 ? <Crumbs crumbs={crumbs} label={t('diagrams.map.breadcrumb')} /> : null}
            {view === 'list' ? (
              <DiagramListView nodes={all} selected={selected} filter={filter} onSelect={select} />
            ) : (
              <DiagramMapView
                map={map}
                nodes={all}
                selected={selected}
                filter={filter}
                now={now}
                onSelect={select}
                onDrill={drill}
                onAddChild={(parent) => setEditing({ parent })}
              />
            )}
            {showArchived ? <DiagramArchivedSection me={me} live={all} archived={archived} /> : null}
          </div>
          {!narrow && panel ? (
            <aside className="card dpanel-wrap" aria-label={t('diagrams.panel.label')}>
              {panel}
            </aside>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('diagrams.title')}
        titleTip={t('diagrams.titleTip')}
        subtitle={t('diagrams.subtitle')}
        actions={
          <div className="dmap-header-tools">
            <input
              className="inp search dmap-search"
              type="search"
              aria-label={t('diagrams.map.searchLabel')}
              placeholder={t('diagrams.map.searchPlaceholder')}
              value={filter.q}
              onChange={(event) => update({ q: event.target.value || null })}
            />
            <SegmentedRadio
              label={t('diagrams.map.viewLabel')}
              value={view}
              onChange={(next) => update({ view: next === 'list' ? 'list' : null })}
              options={[
                { value: 'map', label: t('diagrams.map.viewMap') },
                { value: 'list', label: t('diagrams.map.viewList') },
              ]}
            />
            <button type="button" className="btn primary" onClick={() => setEditing({ parent: null })}>
              {t('diagrams.add')}
            </button>
          </div>
        }
      />
      {body}
      {narrow && sheetOpen && panel && selectedNode ? (
        <Dialog open onOpenChange={() => setSheetOpen(false)} title={t('diagrams.panel.label')} maxWidth={560} initialFocus="title">
          {panel}
        </Dialog>
      ) : null}
      {editing ? (
        <DiagramNodeDialog
          me={me}
          nodes={all.filter((n) => n.kind !== 'presentation')}
          parent={'parent' in editing ? editing.parent : null}
          node={'node' in editing ? editing.node : null}
          run={stepUp.run}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            // Bản vừa tạo được chọn ngay: panel của nó hiện ra, ô sáng lên trên bản đồ.
            if (created) update({ node: saved.id });
          }}
        />
      ) : null}
      {stepUp.dialog}
    </>
  );
}
