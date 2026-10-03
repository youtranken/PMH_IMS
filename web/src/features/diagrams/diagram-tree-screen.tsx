import { useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { Chevron } from '@/ui/chevron';
import { useConfirm } from '@/ui/confirm-provider';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { RowActions, type RowAction } from '@/ui/row-actions';
import { useToast } from '@/ui/toast';
import { NODE_TYPE_KEY, TREE_KEY, statusLabel, type DiagramNode, type DiagramStatus } from './diagram-api';
import { DiagramNodeDialog } from './diagram-node-dialog';
import { newerOfficialSeq } from './diagram-presentation';
import { flattenTree } from './diagram-tree';

const STATUS_TONE: Record<DiagramStatus, string> = {
  empty: 'badge muted',
  draft: 'badge warn',
  official: 'badge ok',
  official_draft: 'badge info',
  pending: 'badge brand',
};

type Editing = { parent: DiagramNode | null } | { node: DiagramNode } | null;

/**
 * Cây bản vẽ (Q-23): CHỈ tên + loại + trạng thái, không ảnh thu nhỏ, không cần mã 2 lớp — mở
 * nội dung mới hỏi mã. Mọi vai tạo được bản vẽ con; đổi tên, chuyển nhánh, lưu trữ chỉ Admin/SA.
 */
export function DiagramTreeScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const ask = useConfirm();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Editing>(null);
  const tree = useQuery({ queryKey: TREE_KEY, queryFn: () => apiFetch<DiagramNode[]>('/api/v1/diagrams') });
  const manager = me.role === 'sa' || me.role === 'admin';

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
    } catch (error) {
      toast({ tone: 'error', message: errorMessage(error) });
    }
  };

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Bản trình bày đứng riêng (Q-23): không nằm trong cây chính thức, không làm cha được.
  const all = tree.data ?? [];
  const nodes = all.filter((n) => n.kind !== 'presentation');
  const presentations = all.filter((n) => n.kind === 'presentation');
  let body;
  if (tree.isPending) body = <Loading />;
  else if (tree.isError) body = <LoadError error={tree.error} onRetry={() => void tree.refetch()} />;
  else if (nodes.length === 0) body = <EmptyState title={t('diagrams.emptyTitle')} hint={t('diagrams.emptyHint')} />;
  else {
    body = (
      <ul className="tree-list" aria-label={t('diagrams.treeLabel')}>
        {flattenTree(nodes, collapsed).map(({ node, depth, hasChildren }) => {
          const items: RowAction[] = [{ key: 'child', label: t('diagrams.addChild'), onSelect: () => setEditing({ parent: node }) }];
          if (manager) {
            items.push({ key: 'edit', label: t('diagrams.edit'), onSelect: () => setEditing({ node }) });
            items.push({ key: 'archive', label: t('diagrams.archive'), warn: true, onSelect: () => void archive(node) });
          }
          return (
            <li key={node.id} className="tree-row" style={{ '--depth': depth } as CSSProperties}>
              {hasChildren ? (
                <button
                  type="button"
                  className="btn-x tree-toggle"
                  aria-expanded={!collapsed.has(node.id)}
                  aria-label={node.name}
                  onClick={() => toggle(node.id)}
                >
                  <Chevron direction={collapsed.has(node.id) ? 'right' : 'down'} />
                </button>
              ) : (
                <span className="tree-toggle" aria-hidden="true" />
              )}
              <Link className="tree-name" to={PATHS.diagram(node.id)}>
                {node.name}
              </Link>
              <span className="badge outline">{t(NODE_TYPE_KEY[node.nodeType])}</span>
              <span className={STATUS_TONE[node.status]}>{statusLabel(node, t)}</span>
              <span className="tree-actions">
                <RowActions label={t('diagrams.actionsOf', { name: node.name })} items={items} />
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <>
      <PageHeader
        title={t('diagrams.title')}
        subtitle={t('diagrams.subtitle')}
        actions={
          <button type="button" className="btn primary" onClick={() => setEditing({ parent: null })}>
            {t('diagrams.add')}
          </button>
        }
      />
      <div className="card">{body}</div>
      {presentations.length > 0 ? (
        <section className="card" aria-labelledby="diagram-presentations-title">
          <h2 id="diagram-presentations-title">{t('diagrams.presentation.section')}</h2>
          <p className="muted">{t('diagrams.presentation.sectionHint')}</p>
          <ul className="tree-list" aria-label={t('diagrams.presentation.section')}>
            {presentations.map((node) => {
              const newer = newerOfficialSeq(node.source);
              return (
                <li key={node.id} className="tree-row">
                  <Link className="tree-name" to={PATHS.diagram(node.id)}>
                    {node.name}
                  </Link>
                  <span className="badge brand">{t('diagrams.presentation.badge')}</span>
                  <span className="muted">
                    {node.source?.name && node.source.seq
                      ? t('diagrams.presentation.fromSource', { name: node.source.name, seq: node.source.seq })
                      : t('diagrams.presentation.fromSourceGone')}
                  </span>
                  {newer ? <span className="badge warn">{t('diagrams.presentation.newer', { seq: newer })}</span> : null}
                  {manager ? (
                    <span className="tree-actions">
                      <RowActions
                        label={t('diagrams.actionsOf', { name: node.name })}
                        items={[{ key: 'archive', label: t('diagrams.archive'), warn: true, onSelect: () => void archive(node) }]}
                      />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {editing ? (
        <DiagramNodeDialog
          me={me}
          nodes={nodes}
          parent={'parent' in editing ? editing.parent : null}
          node={'node' in editing ? editing.node : null}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
