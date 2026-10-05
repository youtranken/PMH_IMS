import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { useConfirm } from '@/ui/confirm-provider';
import { LoadError, Loading } from '@/ui/load-state';
import { useToast } from '@/ui/toast';
import { NODE_TYPE_KEY, TREE_KEY, type DiagramNode } from './diagram-api';
import { canManageNode } from './diagram-presentation';

export const ARCHIVED_KEY = ['diagrams', 'archived'] as const;

/** Bản vẽ đã lưu trữ (không có bia mộ "Xoá hẳn") — thông tin của cây, xem không cần mã. */
export function useArchivedDiagrams() {
  return useQuery({ queryKey: ARCHIVED_KEY, queryFn: () => apiFetch<DiagramNode[]>('/api/v1/diagrams/archived') });
}

/**
 * Khu "Đã lưu trữ" của /diagrams (Q-23): bản đã cất rời bản đồ, nhưng vẫn phải xem lại được. Mở
 * là CHỈ XEM (màn bản vẽ tự khoá Sửa cho bản đã cất, vẫn hỏi mã như mọi lần xem). "Bỏ lưu trữ"
 * chỉ hiện cho người được lưu trữ — cùng `canManageNode` với server.
 */
export function DiagramArchivedSection({ me, live, archived }: { me: Me; live: DiagramNode[]; archived: ReturnType<typeof useArchivedDiagrams> }) {
  const { t } = useTranslation();
  const ask = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const rows = archived.data ?? [];
  const nameOf = (id: string | null) => (id ? ([...live, ...rows].find((n) => n.id === id)?.name ?? null) : null);

  const restore = async (node: DiagramNode) => {
    const ok = await ask({
      title: t('diagrams.archivedList.restoreTitle', { name: node.name }),
      message: t('diagrams.archivedList.restoreMessage'),
      confirmLabel: t('diagrams.archivedList.restore'),
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/v1/diagrams/${node.id}/unarchive`, { method: 'POST', csrfToken: me.csrfToken });
      await Promise.all([queryClient.invalidateQueries({ queryKey: TREE_KEY }), queryClient.invalidateQueries({ queryKey: ARCHIVED_KEY })]);
      toast({ tone: 'ok', message: t('diagrams.archivedList.restored', { name: node.name }) });
    } catch (error) {
      toast({ tone: 'error', message: errorMessage(error) });
    }
  };

  const title = t('diagrams.archivedList.title', { count: rows.length });
  return (
    <section className="dmap-archived" aria-labelledby="dmap-archived-title">
      <h2 id="dmap-archived-title" className="form-section-title">
        {title}
      </h2>
      <p className="muted">{t('diagrams.archivedList.hint')}</p>
      {archived.isPending ? <Loading /> : null}
      {archived.isError ? <LoadError error={archived.error} onRetry={() => void archived.refetch()} /> : null}
      {archived.isSuccess && rows.length === 0 ? <p className="muted">{t('diagrams.archivedList.empty')}</p> : null}
      <ul className="dpanel-rows">
        {rows.map((node) => {
          const parent = nameOf(node.parentId);
          return (
            <li key={node.id} className="dpanel-row">
              <span className="dpanel-row-text">
                <strong>
                  {node.name}{' '}
                  <span className={node.kind === 'presentation' ? 'badge brand' : 'badge outline'}>
                    {node.kind === 'presentation' ? t('diagrams.presentation.badge') : t(NODE_TYPE_KEY[node.nodeType])}
                  </span>
                </strong>
                <span className="muted">
                  {[
                    parent ? t('diagrams.archivedList.under', { name: parent }) : null,
                    t('diagrams.archivedList.by', { by: node.archivedByName ?? node.archivedBy ?? '—', at: formatDateTime(node.archivedAt) }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <Link className="linkbtn sm" to={PATHS.diagram(node.id)} aria-label={t('diagrams.archivedList.openOf', { name: node.name })}>
                {t('diagrams.archivedList.open')}
              </Link>
              {canManageNode(node, me) ? (
                <button
                  type="button"
                  className="btn sm"
                  aria-label={t('diagrams.archivedList.restoreOf', { name: node.name })}
                  onClick={() => void restore(node)}
                >
                  {t('diagrams.archivedList.restore')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
