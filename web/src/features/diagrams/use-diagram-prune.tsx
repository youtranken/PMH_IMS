import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import type { Me } from '@/lib/me';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import { isStepUpCancelled } from '@/ui/use-step-up-retry';
import { TREE_KEY, nodeKey, type DiagramNode } from './diagram-api';

type Run = <T>(action: () => Promise<T>, purpose: string) => Promise<T>;

/** `GET /diagrams/:id/drafts` — số lần lưu sẽ xoá, để hộp xác nhận nói đúng số (Q-23). */
interface DraftPreview {
  count: number;
  ranges: string;
  keepSeq: number | null;
  keptDrafts: number;
  blockedByApprovalId: string | null;
}

/**
 * "Bỏ bản nháp" và "Xoá hẳn" (Q-23) cho thẻ bản vẽ. Cả hai đòi mã sơ đồ (`run` của
 * `useStepUpRetry` trên màn); hộp xác nhận lấy số từ SERVER, không tự đếm phiên bản ở web.
 */
export function useDiagramPrune(me: Me, run: Run, onPurged?: (node: DiagramNode) => void) {
  const { t } = useTranslation();
  const toast = useToast();
  const ask = useConfirm();
  const queryClient = useQueryClient();

  const refresh = async (node: DiagramNode) => {
    await queryClient.invalidateQueries({ queryKey: TREE_KEY });
    await queryClient.invalidateQueries({ queryKey: nodeKey(node.id) });
  };

  const discard = async (node: DiagramNode) => {
    try {
      const preview = await run(() => apiFetch<DraftPreview>(`/api/v1/diagrams/${node.id}/drafts`), t('diagrams.prune.discardStepUp', { name: node.name }));
      if (preview.blockedByApprovalId) {
        toast({ tone: 'error', message: t('diagrams.prune.blocked') });
        return;
      }
      if (preview.count === 0) {
        toast({ tone: 'warn', message: t('diagrams.prune.nothing') });
        return;
      }
      const keep = node.officialVersionId ? t('diagrams.prune.keepOfficial', { seq: preview.keepSeq }) : t('diagrams.prune.keepFirst', { seq: preview.keepSeq });
      const kept = preview.keptDrafts > 0 ? ` ${t('diagrams.prune.kept', { count: preview.keptDrafts })}` : '';
      const ok = await ask({
        title: t('diagrams.prune.discardTitle', { count: preview.count, name: node.name }),
        message: `${t('diagrams.prune.discardMessage', { count: preview.count, ranges: preview.ranges, keep })}${kept}`,
        confirmLabel: t('diagrams.prune.discard'),
        danger: true,
      });
      if (!ok) return;
      const done = await run(
        () => apiFetch<{ count: number; ranges: string }>(`/api/v1/diagrams/${node.id}/drafts/discard`, { method: 'POST', csrfToken: me.csrfToken }),
        t('diagrams.prune.discardStepUp', { name: node.name }),
      );
      await refresh(node);
      toast({ tone: 'ok', message: t('diagrams.prune.discarded', { count: done.count, ranges: done.ranges, name: node.name }) });
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    }
  };

  const purge = async (node: DiagramNode) => {
    const ok = await ask({
      title: t('diagrams.prune.purgeTitle', { name: node.name }),
      message: t('diagrams.prune.purgeMessage'),
      confirmLabel: t('diagrams.prune.purge'),
      danger: true,
      typeToConfirm: { expected: node.name, label: t('diagrams.prune.purgeType') },
    });
    if (!ok) return;
    try {
      await run(
        () => apiFetch(`/api/v1/diagrams/${node.id}/purge`, { method: 'POST', csrfToken: me.csrfToken, body: JSON.stringify({ name: node.name }) }),
        t('diagrams.prune.purgeStepUp', { name: node.name }),
      );
      await refresh(node);
      toast({ tone: 'ok', message: t('diagrams.prune.purged', { name: node.name }) });
      onPurged?.(node);
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    }
  };

  return { discard, purge };
}
