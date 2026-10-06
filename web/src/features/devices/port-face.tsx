import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePortPanel } from '@/ui/use-port-panel';

/**
 * Mặt cổng của máy (Q-26): mỗi cổng vật lý một ô — đang dùng / trống phân biệt bằng màu VÀ chữ
 * (không chỉ màu); rê chuột hay bấm (điện thoại) thấy đầu kia. Bảng dây bên dưới chỉ có cổng đang
 * dùng, nên cổng trống liệt kê riêng sau nút "Hiện cả cổng trống (n)". Máy chưa có danh sách cổng
 * (chưa có Model) thì không vẽ gì — sơ đồ cổng chạy như trước.
 */
export function PortFace({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation();
  const [showFree, setShowFree] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const panel = usePortPanel(deviceId);
  const data = panel.data;
  // Chỉ vẽ khi đúng hình dạng mặt cổng và máy có danh sách cổng.
  if (!data || !Array.isArray(data.ports) || !(data.total > 0)) return null;
  const free = data.ports.filter((p) => !p.peer);
  const current = data.ports.find((p) => p.label === picked) ?? null;

  return (
    <section className="port-face" aria-label={t('ports.face')}>
      <div className="section-bar">
        <h2 className="form-section-title">{t('ports.face')}</h2>
        <span className="section-count">{t('ports.faceCount', { used: data.used, total: data.total })}</span>
      </div>
      <p className="muted small">
        <span className="port-cell" data-used="" aria-hidden="true" /> {t('ports.faceUsed')}{' '}
        <span className="port-cell" aria-hidden="true" /> {t('ports.faceFree')}
      </p>
      <ul className="port-grid" aria-label={t('ports.face')}>
        {data.ports.map((port) => (
          <li key={port.label}>
            <button
              type="button"
              className="port-cell"
              data-used={port.peer ? '' : undefined}
              aria-pressed={picked === port.label}
              title={port.peer ? t('ports.faceTo', { label: port.label, peer: port.peer }) : t('ports.faceIdle', { label: port.label })}
              aria-label={port.peer ? t('ports.faceTo', { label: port.label, peer: port.peer }) : t('ports.faceIdle', { label: port.label })}
              onClick={() => setPicked(picked === port.label ? null : port.label)}
            >
              {port.label}
            </button>
          </li>
        ))}
      </ul>
      {current ? (
        <p role="status" className="small">
          {current.peer ? t('ports.faceTo', { label: current.label, peer: current.peer }) : t('ports.faceIdle', { label: current.label })}
        </p>
      ) : null}
      {(data.unlisted ?? []).length > 0 ? (
        <p className="muted small">{t('ports.faceUnlisted', { labels: data.unlisted.map((u) => u.label).join(', ') })}</p>
      ) : null}
      {free.length > 0 ? (
        <div>
          <button type="button" className="btn sm" aria-expanded={showFree} onClick={() => setShowFree(!showFree)}>
            {showFree ? t('ports.hideFree') : t('ports.showFree', { count: free.length })}
          </button>
          {showFree ? (
            <p className="mono small" aria-label={t('ports.freeList')}>
              {free.map((p) => p.label).join(', ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
