import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { PATHS } from '@/lib/routes';
import { CableSwatch } from '@/ui/cable-swatch';
import { DataItemIfSet } from '@/ui/detail-header';
import { Dialog } from '@/ui/dialog';
import { byDeviceKey, type CableEdge, type CableTypeInfo, type DiagramLink } from './diagram-api';

function ends(link: DiagramLink): string {
  return `${link.deviceCode} ${link.portLabel} ↔ ${link.peerDeviceCode} ${link.peerPort ?? '—'}`;
}

/**
 * Thẻ dây ở chế độ xem: cổng hai đầu, loại dây, VLAN, ghi chú — đọc từ sơ đồ cổng HIỆN TẠI (qua
 * `devices.api`, server gom kèm nội dung), không từ XML. Nét "Chỉ vẽ" / nét có kết nối đã gỡ nói
 * thẳng điều đó.
 */
export function DiagramCableCard({
  edge,
  link,
  cableTypes,
  onClose,
}: {
  edge: CableEdge;
  link: DiagramLink | null;
  cableTypes: CableTypeInfo[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const cable = link?.cableTypeId ? cableTypes.find((c) => c.id === link.cableTypeId) : undefined;
  const title = link && edge.state === 'linked' ? ends(link) : t('diagrams.cable.legendUndeclared');
  return (
    <Dialog open onOpenChange={onClose} title={t('diagrams.cable.cardTitle', { label: title })} initialFocus="title">
      {edge.state === 'undeclared' ? (
        <p className="alert warn" role="status">
          {t('diagrams.cable.cardUndeclared')}
        </p>
      ) : edge.state === 'removed' ? (
        <p className="alert error" role="status">
          {t('diagrams.cable.cardRemoved')}
        </p>
      ) : edge.state !== 'linked' ? (
        <p className="alert error" role="status">
          {t('diagrams.cable.cardMismatch')}
        </p>
      ) : null}
      {link && edge.state === 'linked' ? (
        <dl className="data-grid">
          <DataItemIfSet label={t('diagrams.cable.cardEnds')} value={ends(link)}>
            <span className="mono">{ends(link)}</span>
          </DataItemIfSet>
          <DataItemIfSet label={t('diagrams.cable.cableType')} value={cable?.name}>
            <CableSwatch slot={cable?.colorSlot} /> {cable?.name}
            {cable && !cable.active ? <span className="muted"> {t('diagrams.cable.retiredSuffix')}</span> : null}
          </DataItemIfSet>
          <DataItemIfSet label={t('diagrams.cable.cardVlan')} value={link.vlan} />
          <DataItemIfSet label={t('diagrams.cable.cardNote')} value={link.note} />
        </dl>
      ) : null}
    </Dialog>
  );
}

/**
 * Mục "Kết nối" trong thẻ thiết bị: dây tới máy CÓ trên bản vẽ (cổng ↔ cổng), và mũi tên tới máy
 * KHÔNG có trên bản vẽ — "→ Core-01 (bản vẽ Phòng server)", bấm là sang bản vẽ đó và bay tới máy
 * (trong ân hạn mã sơ đồ thì không hỏi lại).
 */
export function DeviceConnections({
  deviceId,
  diagramId,
  links,
  onDrawing,
}: {
  deviceId: string;
  diagramId: string;
  links: DiagramLink[];
  /** Máy có ô trên bản vẽ này. */
  onDrawing: Set<string>;
}) {
  const { t } = useTranslation();
  const mine = links.filter((l) => l.deviceId === deviceId || l.peerDeviceId === deviceId);
  const otherOf = (l: DiagramLink) => (l.deviceId === deviceId ? { id: l.peerDeviceId, code: l.peerDeviceCode } : { id: l.deviceId, code: l.deviceCode });
  const external = [...new Map(mine.map(otherOf).filter((o) => !onDrawing.has(o.id)).map((o) => [o.id, o])).values()];
  const where = useQueries({
    queries: external.map((other) => ({
      queryKey: byDeviceKey(other.id),
      queryFn: () => apiFetch<{ id: string; name: string }[]>(`/api/v1/diagrams/by-device/${other.id}`),
    })),
  });
  const diagramsOf = new Map(external.map((o, i) => [o.id, (where[i]?.data ?? []).filter((d) => d.id !== diagramId)]));
  return (
    <section aria-label={t('diagrams.cable.connections')}>
      <h3 className="form-section-title">{t('diagrams.cable.connections')}</h3>
      {mine.length === 0 ? (
        <p className="muted">{t('diagrams.cable.connectionsNone')}</p>
      ) : (
        <ul className="device-card-diagrams">
          {mine.map((link) => {
            const other = otherOf(link);
            const label = link.deviceId === deviceId ? link.labelFromA : link.labelFromB;
            if (onDrawing.has(other.id)) {
              return (
                <li key={link.id}>
                  <span className="mono">{label}</span> · {other.code}
                </li>
              );
            }
            const targets = diagramsOf.get(other.id) ?? [];
            return (
              <li key={link.id}>
                <span className="mono">{label}</span>{' '}
                {targets.length === 0 ? (
                  t('diagrams.cable.toNoDiagram', { code: other.code })
                ) : (
                  targets.map((d) => (
                    <Link key={d.id} to={`${PATHS.diagram(d.id)}?focus=${encodeURIComponent(other.id)}`}>
                      {t('diagrams.cable.toOtherDiagram', { code: other.code, name: d.name })}
                    </Link>
                  ))
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
