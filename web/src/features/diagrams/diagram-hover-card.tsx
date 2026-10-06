import { useTranslation } from 'react-i18next';
import { STATUS_KEY, type DeviceStatus } from '@/lib/device-types';
import type { HoverCardData, HoverRowKey } from './diagram-hover';

const STATE_KEY: Record<string, string> = {
  linked: 'diagrams.hover.stateLinked',
  undeclared: 'diagrams.hover.stateUndeclared',
  removed: 'diagrams.hover.stateRemoved',
  mismatch: 'diagrams.hover.stateMismatch',
  duplicate: 'diagrams.hover.stateDuplicate',
};

const LABEL_KEY: Record<HoverRowKey, string> = {
  ip: 'diagrams.hover.ip',
  model: 'diagrams.hover.model',
  location: 'diagrams.hover.location',
  ports: 'diagrams.hover.ports',
  status: 'diagrams.hover.status',
  cableType: 'diagrams.hover.cableType',
  state: 'diagrams.hover.state',
};

/**
 * Nội dung thẻ máy / dây (Q-23): tab Xem đặt nó cạnh con trỏ (`DiagramViewer` `hoverCard`),
 * tab Sửa neo nó ở đáy trình vẽ kèm nút "Chi tiết" (`onDetails`). Chỉ đọc dữ liệu đã có — không gọi API.
 */
export function DiagramHoverCard({ data, onDetails }: { data: HoverCardData; onDetails?: () => void }) {
  const { t } = useTranslation();
  const value = (key: HoverRowKey, raw: string) => {
    if (key === 'status') return STATUS_KEY[raw as DeviceStatus] ? t(STATUS_KEY[raw as DeviceStatus]) : raw;
    if (key === 'state') return STATE_KEY[raw] ? t(STATE_KEY[raw]) : raw;
    return raw;
  };
  return (
    <>
      <p className="diagram-hover-title">{data.title ?? t('diagrams.hover.cableUnnamed')}</p>
      {data.missing ? <p className="muted">{t('diagrams.hover.missing')}</p> : null}
      {data.rows.length > 0 ? (
        <dl className="diagram-hover-rows">
          {data.rows.map((row) => (
            <div key={row.key} className="diagram-hover-row">
              <dt title={row.key === 'ports' ? t('diagrams.hover.portsHint') : undefined}>{t(LABEL_KEY[row.key])}</dt>
              <dd className={row.key === 'ip' || row.key === 'ports' ? 'mono' : undefined}>{value(row.key, row.value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {onDetails ? (
        <div className="diagram-hover-actions">
          <button type="button" className="btn sm" onClick={onDetails}>
            {t('diagrams.hover.details')}
          </button>
        </div>
      ) : null}
    </>
  );
}
