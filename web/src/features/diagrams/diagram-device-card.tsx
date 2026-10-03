import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { DataItemIfSet } from '@/ui/detail-header';
import { Dialog } from '@/ui/dialog';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { PhoneLink } from '@/ui/phone-link';
import { VaultPanel } from '@/ui/vault-panel';
import { byDeviceKey, type DiagramDeviceInfo } from './diagram-api';

/**
 * Thẻ thông tin của một ô thiết bị ở chế độ xem (Story Thiết bị kho): đọc từ kho HIỆN TẠI qua
 * `devices`/`ipam`/`catalog` (server gom một lượt), không từ XML bản vẽ.
 *
 * "Mở két" mở đúng `VaultPanel` dùng ở trang thiết bị và Két tổng (AD-15): luật 3 tầng quyền,
 * gõ mã phạm vi KÉT, nhật ký — y hệt. Thẻ không cầm giá trị két nào, và `diagrams` không gọi
 * `vault` (AD-4, AD-18): mã đang còn ân hạn của sơ đồ không mở được két.
 */
export function DiagramDeviceCard({
  me,
  device,
  code,
  diagramId,
  onClose,
  children,
}: {
  me: Me;
  /** `null` = ô trỏ tới máy không có trong danh sách server trả (coi như không tìm thấy). */
  device: DiagramDeviceInfo | null;
  /** Mã đọc được từ ô (`ims_device_code`) — dùng khi máy không còn trong kho. */
  code: string;
  diagramId: string;
  onClose: () => void;
  /** Phần thêm cuối thẻ (vd mục "Kết nối" của màn sơ đồ). */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [vaultOpen, setVaultOpen] = useState(false);
  const found = Boolean(device?.found);
  const deviceId = device?.id ?? '';
  const diagrams = useQuery({
    queryKey: byDeviceKey(deviceId),
    queryFn: () => apiFetch<{ id: string; name: string }[]>(`/api/v1/diagrams/by-device/${deviceId}`),
    enabled: found,
  });

  if (!device || !found) {
    return (
      <Dialog open onOpenChange={onClose} title={t('diagrams.card.missingTitle', { code })} initialFocus="title">
        <p className="alert error" role="alert">
          {t('diagrams.card.missing')}
        </p>
        <p className="muted">{t('diagrams.card.missingHint')}</p>
      </Dialog>
    );
  }

  const retired = device.status === 'retired';
  const where = [device.siteCode, device.cabinetCode, device.u !== null ? `U${device.u}` : null].filter(Boolean).join(' · ');
  const others = (diagrams.data ?? []).filter((d) => d.id !== diagramId);

  return (
    <>
      <Dialog
        open={!vaultOpen}
        onOpenChange={onClose}
        title={device.code ?? code}
        initialFocus="title"
        footer={
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Link className="linkbtn" to={PATHS.device(device.id)}>
              {t('diagrams.card.openRecord')}
            </Link>
            <button type="button" className="btn primary" onClick={() => setVaultOpen(true)}>
              {t('diagrams.card.openVault')}
            </button>
          </div>
        }
      >
        {retired ? (
          <p className="alert warn" role="status">
            {t('diagrams.card.retired')}
          </p>
        ) : null}
        <dl className="data-grid">
          <DataItemIfSet label={t('diagrams.card.name')} value={device.name} />
          <DataItemIfSet label={t('diagrams.card.type')} value={device.deviceTypeName} />
          <DataItemIfSet label={t('diagrams.card.model')} value={device.model} />
          <DataItemIfSet label={t('diagrams.card.serial')} value={device.serial}>
            <span className="mono">{device.serial}</span>
          </DataItemIfSet>
          <DataItemIfSet label={t('diagrams.card.ip')} value={device.ips.join(', ')}>
            <span className="mono">{device.ips.join(', ')}</span>
          </DataItemIfSet>
          <DataItemIfSet label={t('diagrams.card.location')} value={where} />
          <DataItemIfSet label={t('diagrams.card.vendor')} value={device.vendorName}>
            {device.vendorName}
            {device.vendorPhone ? (
              <>
                {' · '}
                <PhoneLink value={device.vendorPhone} />
              </>
            ) : null}
          </DataItemIfSet>
          <DataItemIfSet label={t('diagrams.card.warranty')} value={device.warrantyEnd}>
            <ExpiryBadge end={device.warrantyEnd} showDate notCounted={retired} />
          </DataItemIfSet>
        </dl>
        <section aria-label={t('diagrams.card.presence')}>
          <h3 className="form-section-title">{t('diagrams.card.presence')}</h3>
          {diagrams.isError ? (
            <p className="muted">{t('diagrams.card.presenceFailed')}</p>
          ) : diagrams.isSuccess && others.length === 0 ? (
            <p className="muted">{t('diagrams.card.presenceOnlyHere')}</p>
          ) : (
            <ul className="device-card-diagrams">
              {others.map((d) => (
                <li key={d.id}>
                  <Link to={PATHS.diagram(d.id)}>{d.name}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        {children}
      </Dialog>
      {vaultOpen ? (
        <Dialog
          open
          onOpenChange={() => setVaultOpen(false)}
          maxWidth={760}
          title={t('diagrams.card.vaultTitle', { code: device.code ?? code })}
        >
          <p className="muted">{t('diagrams.card.vaultHint')}</p>
          <VaultPanel ownerType="device" ownerId={device.id} ownerLabel={device.code ?? code} me={me} canEdit={false} locked={retired} stepsInline />
        </Dialog>
      ) : null}
    </>
  );
}
