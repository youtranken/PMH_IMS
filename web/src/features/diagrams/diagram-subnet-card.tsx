import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { PATHS } from '@/lib/routes';
import { DataItemIfSet } from '@/ui/detail-header';
import { Dialog } from '@/ui/dialog';
import { Loading } from '@/ui/load-state';
import { subnetInfoKey, type DiagramFrame, type SubnetSummary } from './diagram-api';

/**
 * Thẻ khung VLAN ở chế độ xem (FR-039): CIDR, VLAN, site, số IP đã cấp / còn trống và vài IP trống
 * đầu tiên — đọc từ IPAM HIỆN TẠI qua server (`ipam.api`), không từ bản vẽ. Dải đã ngừng dùng vẫn
 * mở được, kèm "(ngừng dùng)".
 */
export function DiagramSubnetCard({ frame, onClose }: { frame: DiagramFrame & { subnetId: string }; onClose: () => void }) {
  const { t } = useTranslation();
  const info = useQuery({
    queryKey: subnetInfoKey(frame.subnetId),
    queryFn: () => apiFetch<SubnetSummary>(`/api/v1/diagrams/subnet-info/${frame.subnetId}`),
    retry: false,
  });
  const data = info.data;
  const title = data
    ? `${t('diagrams.frames.subnetTitle', { cidr: data.cidr })}${data.voided ? ` ${t('diagrams.frames.subnetVoided')}` : ''}`
    : frame.label || t('diagrams.frames.subnet');

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={title}
      initialFocus="title"
      footer={
        data ? (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Link className="linkbtn" to={PATHS.subnet(data.id)}>
              {t('diagrams.frames.subnetOpen')}
            </Link>
          </div>
        ) : undefined
      }
    >
      {info.isPending ? (
        <Loading />
      ) : info.isError || !data ? (
        <p className="alert error" role="alert">
          {t('diagrams.frames.subnetLoadFailed')}
        </p>
      ) : (
        <>
          {data.voided ? (
            <p className="alert warn" role="status">
              {t('diagrams.frames.subnetVoidedHint')}
            </p>
          ) : null}
          <dl className="data-grid">
            <DataItemIfSet label={t('diagrams.frames.subnetName')} value={data.name} />
            <DataItemIfSet label={t('diagrams.frames.subnetVlan')} value={data.vlan !== null ? String(data.vlan) : null} />
            <DataItemIfSet label={t('diagrams.frames.subnetSite')} value={data.siteCode} />
            <DataItemIfSet label={t('diagrams.frames.subnetGateway')} value={data.gateway}>
              <span className="mono">{data.gateway}</span>
            </DataItemIfSet>
            <DataItemIfSet
              label={t('diagrams.frames.subnetUsage')}
              value={t('diagrams.frames.subnetUsageValue', { used: data.used, free: data.free, total: data.total })}
            />
            <DataItemIfSet
              label={t('diagrams.frames.subnetFirstFree')}
              value={data.firstFree.length > 0 ? data.firstFree.join(', ') : t('diagrams.frames.subnetNoFree')}
            >
              {data.firstFree.length > 0 ? <span className="mono">{data.firstFree.join(', ')}</span> : t('diagrams.frames.subnetNoFree')}
            </DataItemIfSet>
          </dl>
        </>
      )}
    </Dialog>
  );
}
