import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { PATHS } from '@/lib/routes';
import { Crumbs, type Crumb } from '@/ui/detail-header';
import { TREE_KEY, type DiagramNode } from './diagram-api';
import { pathOf } from './diagram-tree';

/**
 * Thanh đường dẫn của màn bản vẽ: "Cây bản vẽ > Tổng > Tower > Tầng 3" — mỗi cấp cha bấm lên được
 * (FR-039: khung bản vẽ con bấm xuống, đường dẫn bấm lên). Đường đi theo CÂY (`GET /diagrams`, thông
 * tin không cần mã), nên lên một cấp là mở bản vẽ cha; trong ân hạn mã sơ đồ thì không hỏi lại.
 * Cây chưa tải hoặc tải hỏng thì chỉ còn mục "Cây bản vẽ" — không chặn màn.
 */
export function DiagramBreadcrumb({ diagramId }: { diagramId: string }) {
  const { t } = useTranslation();
  const tree = useQuery({ queryKey: TREE_KEY, queryFn: () => apiFetch<DiagramNode[]>('/api/v1/diagrams') });
  const ancestors = tree.data ? pathOf(tree.data, diagramId).slice(0, -1) : [];
  const crumbs: Crumb[] = [
    { label: t('diagrams.screen.backToTree'), to: PATHS.diagrams },
    ...ancestors.map((node) => ({ label: node.name, to: PATHS.diagram(node.id) })),
  ];
  return <Crumbs crumbs={crumbs} label={t('diagrams.frames.breadcrumb')} />;
}
