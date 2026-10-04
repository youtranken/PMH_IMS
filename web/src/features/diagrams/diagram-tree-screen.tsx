import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { BREAKPOINTS } from '@/ui/breakpoints';
import { useConfirm } from '@/ui/confirm-provider';
import { Crumbs, type Crumb } from '@/ui/detail-header';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import type { RowAction } from '@/ui/row-actions';
import { Select } from '@/ui/select';
import { StepList } from '@/ui/step-list';
import { useToast } from '@/ui/toast';
import { useMediaQuery } from '@/ui/use-media-query';
import { useIsNarrow } from '@/ui/use-narrow';
import { useNow } from '@/ui/use-now';
import { useStepUpRetry } from '@/ui/use-step-up-retry';
import { STATUS_KEY, TREE_KEY, type DiagramNode } from './diagram-api';
import {
  PRESENTATIONS_NODE,
  STATUS_FILTERS,
  boardCards,
  boardRows,
  canDiscardDrafts,
  canPurge,
  expandedFor,
  resolveSelection,
  type StatusFilter,
} from './diagram-board';
import { DiagramBoardTree } from './diagram-board-tree';
import { DiagramCard } from './diagram-card';
import { DiagramNodeDialog } from './diagram-node-dialog';
import { canManageNode } from './diagram-presentation';
import { enterFullscreen } from './diagram-slideshow';
import { pathOf } from './diagram-tree';
import { useDiagramPrune } from './use-diagram-prune';

type Editing = { parent: DiagramNode | null } | { node: DiagramNode } | null;

/** Nhịp làm mới chữ "2 giờ trước" của thẻ. */
const AGO_TICK_MS = 60_000;

/**
 * Cây bản vẽ (Q-23) hai cột: cây bên trái, thẻ của nút đang chọn + bản vẽ con bên phải. CHỈ tên,
 * loại, trạng thái, lần lưu cuối — không ảnh thu nhỏ, không cần mã 2 lớp; mở nội dung mới hỏi mã.
 * Nút đang chọn nằm ở `?node=` (mở lại link vẫn đúng chỗ). Màn hẹp: cây thành ô chọn phía trên,
 * thẻ xếp một cột.
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
  const [filter, setFilter] = useState<StatusFilter>('all');
  const stepUp = useStepUpRetry(me.csrfToken);
  const tree = useQuery({ queryKey: TREE_KEY, queryFn: () => apiFetch<DiagramNode[]>('/api/v1/diagrams') });
  const all = useMemo(() => tree.data ?? [], [tree.data]);

  const selected = resolveSelection(all, params.get('node'));
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  // Mở sẵn gốc + đường tới nút chọn; người dùng thu/mở tay thì nhớ lựa chọn đó.
  const expanded = useMemo(() => {
    const roots = all.filter((n) => n.kind !== 'presentation' && !n.parentId).map((n) => n.id);
    const next = expandedFor(all, selected, new Set([...roots, ...opened]));
    for (const id of closed) next.delete(id);
    return next;
  }, [all, selected, opened, closed]);

  const select = (id: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set('node', id);
        else next.delete('node');
        return next;
      },
      { replace: true },
    );

  const toggle = (id: string) => {
    const open = !expanded.has(id);
    setOpened((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
    setClosed((current) => {
      const next = new Set(current);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const prune = useDiagramPrune(me, stepUp.run, (node) => {
    if (node.id === selected) select(node.parentId);
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
      if (node.id === selected) select(node.parentId);
    } catch (error) {
      toast({ tone: 'error', message: errorMessage(error) });
    }
  };

  const actionsOf = (node: DiagramNode): RowAction[] => {
    const items: RowAction[] = [];
    if (node.kind !== 'presentation') {
      items.push({
        key: 'present',
        label: t('diagrams.slideshow.start'),
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
    if (canDiscardDrafts(node, me)) {
      items.push({ key: 'discard', label: t('diagrams.prune.discard'), hint: t('diagrams.prune.discardHint'), danger: true, onSelect: () => void prune.discard(node) });
    }
    if (canPurge(node, all, me)) {
      items.push({ key: 'purge', label: t('diagrams.prune.purge'), hint: t('diagrams.prune.purgeHint'), danger: true, onSelect: () => void prune.purge(node) });
    }
    return items;
  };

  const official = all.filter((n) => n.kind !== 'presentation');
  const presentationCount = all.length - official.length;
  const rows = boardRows(all, expanded);
  const cards = boardCards(all, selected, filter);
  const selectedNode = all.find((n) => n.id === selected) ?? null;

  const crumbs: Crumb[] =
    selected === PRESENTATIONS_NODE
      ? [{ label: t('diagrams.board.presentationsCrumb') }]
      : selectedNode?.kind === 'presentation'
        ? [{ label: t('diagrams.board.presentationsCrumb'), to: `?node=${PRESENTATIONS_NODE}` }, { label: selectedNode.name }]
        : pathOf(official, selected ?? '').map((n, index, path) => (index === path.length - 1 ? { label: n.name } : { label: n.name, to: `?node=${n.id}` }));

  const pickerOptions = [
    ...boardRows(all, new Set([...official.map((n) => n.id), PRESENTATIONS_NODE])).map((row) => ({
      value: row.id,
      label: row.node
        ? row.node.kind === 'presentation'
          ? `${t('diagrams.board.presentationsCrumb')} / ${row.node.name}`
          : pathOf(official, row.id).map((p) => p.name).join(' / ')
        : t('diagrams.board.presentationsGroup', { count: presentationCount }),
    })),
  ];

  let body;
  if (tree.isPending) body = <Loading />;
  else if (tree.isError) body = <LoadError error={tree.error} onRetry={() => void tree.refetch()} />;
  else if (all.length === 0) {
    // Màn trống nói luôn cả lộ trình, không chỉ bước đầu: người mới mở không biết cây dùng thế nào.
    body = (
      <div className="card">
        <EmptyState title={t('diagrams.emptyTitle')} hint={t('diagrams.emptyHint')} />
        <StepList
          label={t('diagrams.stepsLabel')}
          steps={[t('diagrams.treeSteps.root'), t('diagrams.treeSteps.child'), t('diagrams.treeSteps.open'), t('diagrams.treeSteps.publish')]}
        />
      </div>
    );
  } else {
    const listLabel =
      selected === PRESENTATIONS_NODE
        ? t('diagrams.board.presentationsCards')
        : t('diagrams.board.cardsOf', { name: selectedNode?.name ?? '' });
    const showChildren = selected === PRESENTATIONS_NODE || selectedNode?.kind === 'official';
    body = (
      <div className="board-split">
        {narrow ? (
          <Select
            value={selected ?? ''}
            onChange={(id) => select(id)}
            options={pickerOptions}
            ariaLabel={t('diagrams.board.pickLabel')}
            searchable
          />
        ) : (
          <nav className="card board-rail" aria-label={t('diagrams.board.treeTitle')}>
            <h2 className="form-section-title">{t('diagrams.board.treeTitle')}</h2>
            <DiagramBoardTree rows={rows} selected={selected} presentationCount={presentationCount} onSelect={select} onToggle={toggle} />
          </nav>
        )}
        <div className="board-main">
          <Crumbs crumbs={crumbs} label={t('diagrams.board.breadcrumb')} />
          {showChildren ? (
            <div className="toolbar board-toolbar">
              {selectedNode?.kind === 'official' ? (
                <button type="button" className="btn sm primary" onClick={() => setEditing({ parent: selectedNode })}>
                  {t('diagrams.board.addChild')}
                </button>
              ) : null}
              <Select
                className="board-filter"
                value={filter}
                onChange={(value) => setFilter(value as StatusFilter)}
                ariaLabel={t('diagrams.board.filter')}
                options={STATUS_FILTERS.map((s) => ({
                  value: s,
                  label: s === 'all' ? t('diagrams.board.filterAll') : t(STATUS_KEY[s]),
                }))}
              />
            </div>
          ) : null}
          <ul className="board-cards" aria-label={listLabel}>
            {cards.self ? <DiagramCard node={cards.self} self now={now} canEdit={!noEditor} items={actionsOf(cards.self)} /> : null}
            {cards.children.map((node) => (
              <DiagramCard key={node.id} node={node} now={now} canEdit={!noEditor} items={actionsOf(node)} />
            ))}
          </ul>
          {showChildren && cards.children.length === 0 ? (
            cards.total > 0 ? (
              <p className="muted">{t('diagrams.board.noMatch')}</p>
            ) : selected === PRESENTATIONS_NODE ? null : (
              <EmptyState title={t('diagrams.board.noChildren')} hint={t('diagrams.board.noChildrenHint')} />
            )
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t('diagrams.title')}
        titleTip={t('diagrams.titleTip')}
        subtitle={t('diagrams.subtitle')}
        actions={
          <button type="button" className="btn primary" onClick={() => setEditing({ parent: null })}>
            {t('diagrams.add')}
          </button>
        }
      />
      {body}
      {editing ? (
        <DiagramNodeDialog
          me={me}
          nodes={official}
          parent={'parent' in editing ? editing.parent : null}
          node={'node' in editing ? editing.node : null}
          run={stepUp.run}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            // Gốc mới: chọn nó. Con mới: chọn cha của nó — thẻ con hiện ngay bên phải.
            if (created) select(saved.parentId ?? saved.id);
          }}
        />
      ) : null}
      {stepUp.dialog}
    </>
  );
}
