import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { PATHS } from '@/lib/routes';
import { DetailSection } from '@/ui/detail-layout';
import { diagramStatusLabel, type DiagramTreeStatus } from '@/ui/diagram-version';
import { LoadError, Loading } from '@/ui/load-state';

/** Một nút của cây bản vẽ — chỉ phần khu này đọc (tên, trạng thái là thông tin của cây, không cần mã). */
interface TreeNode {
  id: string;
  status: DiagramTreeStatus;
  officialSeq?: number | null;
}

/**
 * Khu "Có trên sơ đồ" của hồ sơ thiết bị (T-01): trước khi thanh lý hay đổi cổng, IT cần biết bản
 * vẽ nào sẽ lệch kho. Danh sách lấy từ `GET /diagrams/by-device/:id` (bản vẽ chính thức đang dùng
 * có máy ở lần lưu mới nhất); trạng thái từ cây. Không đọc nội dung bản vẽ: mở link mới hỏi mã sơ
 * đồ, và `?focus=` bay tới đúng máy.
 */
export function DeviceOnDiagrams({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation();
  const refs = useQuery({
    queryKey: ['diagrams-by-device', deviceId],
    queryFn: () => apiFetch<{ id: string; name: string }[]>(`/api/v1/diagrams/by-device/${deviceId}`),
  });
  const tree = useQuery({
    // Cùng khoá với cây của màn sơ đồ (`TREE_KEY`): một lần tải dùng chung cho hai màn.
    queryKey: ['diagrams'],
    queryFn: () => apiFetch<TreeNode[]>('/api/v1/diagrams'),
    enabled: (refs.data ?? []).length > 0,
  });
  const byId = new Map((tree.data ?? []).map((node) => [node.id, node]));
  const title = refs.data ? t('devices.onDiagramsTitle', { count: refs.data.length }) : t('devices.onDiagramsTitleBare');
  return (
    <DetailSection title={title} compact>
      {refs.isPending ? (
        <Loading />
      ) : refs.isError ? (
        <LoadError error={refs.error} onRetry={() => void refs.refetch()} />
      ) : refs.data.length === 0 ? (
        <p className="muted">{t('devices.onDiagramsNone')}</p>
      ) : (
        <ul className="device-card-diagrams">
          {refs.data.map((ref) => {
            const node = byId.get(ref.id);
            return (
              <li key={ref.id}>
                <Link className="linkbtn" to={`${PATHS.diagram(ref.id)}?${new URLSearchParams({ focus: deviceId }).toString()}`}>
                  {ref.name}
                </Link>{' '}
                {node ? <span className="badge outline">{diagramStatusLabel(t, node.status, node.officialSeq)}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </DetailSection>
  );
}
