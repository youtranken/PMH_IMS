import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import type { Me } from '@/lib/me';
import type { CableEdge, DiagramContent, DiagramDeviceInfo, DiagramLink } from './diagram-api';
import { DeviceConnections, DiagramCableCard } from './diagram-cable-card';
import { DiagramDeviceCard } from './diagram-device-card';
import { cableHoverData, deviceHoverData, type HoverCardData, type selectedTarget } from './diagram-hover';
import { DiagramHoverCard } from './diagram-hover-card';

type Target = NonNullable<ReturnType<typeof selectedTarget>>;

/**
 * Thẻ của ô đang CHỌN ở tab Sửa (Q-23 06/10): draw.io không báo rê chuột, nên màn hỏi ô đang chọn
 * (`export` json) và neo thẻ ở đáy trình vẽ. "Chi tiết" mở thẻ chi tiết NGAY trong màn sửa — rời
 * màn là bỏ bản vẽ dở, nên "Mở hồ sơ" của thẻ chi tiết mở tab mới.
 */
export function DiagramSelectionCard({
  me,
  diagramId,
  content,
  target,
  linkOf,
  onDrawing,
}: {
  me: Me;
  diagramId: string;
  content: DiagramContent;
  target: Target;
  linkOf: (linkId: string) => DiagramLink | undefined;
  /** Máy đang có trên bản vẽ — mục "Kết nối" của thẻ chi tiết chia dây trên / ngoài bản vẽ. */
  onDrawing: Set<string>;
}) {
  const { t } = useTranslation();
  const [details, setDetails] = useState(false);
  const deviceId = target.kind === 'device' ? target.deviceId : '';
  const known = deviceId ? (content.devices ?? []).find((d) => d.id === deviceId) : undefined;
  // Máy chèn sau lúc mở không có trong nội dung đã tải: đọc thông tin kho của riêng máy đó.
  const fetched = useQuery({
    queryKey: ['diagram-device-info', deviceId],
    queryFn: () => apiFetch<DiagramDeviceInfo[]>(`/api/v1/diagrams/device-info?ids=${encodeURIComponent(deviceId)}`),
    enabled: Boolean(deviceId) && !known,
    staleTime: 60_000,
  });
  const info = known ?? fetched.data?.[0] ?? null;

  let data: HoverCardData;
  let edge: CableEdge | null = null;
  let link: DiagramLink | null = null;
  if (target.kind === 'device') {
    data = info || fetched.isError || fetched.isSuccess ? deviceHoverData(info, target.code) : { kind: 'device', title: target.code, deviceId: null, rows: [] };
  } else {
    link = linkOf(target.linkId) ?? null;
    edge = { cellId: target.cellId, linkId: target.linkId, state: link ? 'linked' : 'removed', sourceDeviceId: null, targetDeviceId: null };
    data = cableHoverData(edge, link, content.cableTypes ?? []);
  }

  return (
    <>
      <section className="diagram-hover-card" data-docked="" aria-label={t('diagrams.hover.selected')}>
        <DiagramHoverCard data={data} onDetails={() => setDetails(true)} />
      </section>
      {details && target.kind === 'device' ? (
        <DiagramDeviceCard me={me} device={info} code={target.code} diagramId={diagramId} onClose={() => setDetails(false)} recordInNewTab>
          {info?.found ? <DeviceConnections deviceId={info.id} diagramId={diagramId} links={content.links ?? []} onDrawing={onDrawing} /> : null}
        </DiagramDeviceCard>
      ) : null}
      {details && edge ? <DiagramCableCard edge={edge} link={link} cableTypes={content.cableTypes ?? []} onClose={() => setDetails(false)} /> : null}
    </>
  );
}
