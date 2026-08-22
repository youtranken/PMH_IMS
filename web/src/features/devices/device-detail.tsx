import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDate, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { HistoryPanel } from '@/ui/history-panel';
import { LoadError, Loading, NotFound } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { TabPanel, Tabs } from '@/ui/tabs';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import type { CatalogLists } from '@/features/catalog/catalog-types';
import { DeviceForm } from './device-form';
import { toHistoryEntries } from './device-history-entries';
import {
  STATUS_KEY,
  STATUS_TONE,
  locationLabel,
  type DeviceHistoryRow,
  type DeviceRow,
} from './device-types';

/**
 * Trang chi tiết thiết bị (story 2.2 phần hồ sơ + lịch sử FR-007).
 *
 * Story 2.5 sẽ THÊM tab Giấy tờ / Port map và các panel IP · license · secret · phiếu
 * vào đúng chỗ này — khung tab dựng sẵn để lúc đó chỉ cắm thêm, không phải vẽ lại trang.
 */
export function DeviceDetail({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const { id = '' } = useParams();
  const [tab, setTab] = useState('profile');
  const [editing, setEditing] = useState(false);

  const device = useQuery({
    queryKey: ['devices', id],
    queryFn: () => apiFetch<DeviceRow>(`/api/v1/devices/${id}`),
    retry: false,
  });

  const history = useQuery({
    queryKey: ['devices', id, 'history'],
    queryFn: () => apiFetch<DeviceHistoryRow[]>(`/api/v1/devices/${id}/history`),
    enabled: tab === 'history',
  });

  const lists = useQuery({
    queryKey: ['catalog', 'lists'],
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
    enabled: editing,
  });

  const setStatus = useApiMutation<{ status: string }, unknown>(
    `/api/v1/devices/${id}/status`,
    { method: 'PATCH', csrfToken: me.csrfToken, refreshMe: false },
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['devices'] });

  if (device.isLoading) return <Loading />;
  if (device.isError) {
    // 404 là "thiết bị không tồn tại" — trang 404 tử tế, không phải khối lỗi đỏ.
    return device.error instanceof Error && 'status' in device.error &&
      (device.error as { status?: number }).status === 404 ? (
      <NotFound />
    ) : (
      <LoadError onRetry={() => void device.refetch()} />
    );
  }

  const item = device.data!;
  const retired = item.status === 'retired';

  return (
    <>
      <PageHeader
        title={`${item.code} — ${item.name}`}
        subtitle={`${item.deviceTypeName} · ${locationLabel(item)}`}
        actions={
          <>
            <Link className="btn" to="/thiet-bi">
              {t('devices.back')}
            </Link>
            <button
              type="button"
              className="btn"
              disabled={retired}
              title={retired ? t('devices.retiredLocked') : undefined}
              onClick={() => setEditing(true)}
            >
              {t('devices.edit')}
            </button>
            <button
              type="button"
              className={`btn${retired ? '' : ' danger'}`}
              onClick={() => {
                void (async () => {
                  if (!retired) {
                    const ok = await askConfirm({
                      message: t('devices.confirmRetire', { name: item.code }),
                      danger: true,
                    });
                    if (!ok) return;
                  }
                  setStatus.mutate(
                    { status: retired ? 'in_use' : 'retired' },
                    {
                      onSuccess: () => {
                        toast({ message: t('devices.statusChanged') });
                        void refresh();
                      },
                      onError: (err) => toast({ message: errorMessage(err), tone: 'error' }),
                    },
                  );
                })();
              }}
            >
              {t(retired ? 'devices.reopen' : 'devices.retire')}
            </button>
          </>
        }
      />

      {retired ? <p className="alert">{t('devices.retiredLocked')}</p> : null}

      <Tabs
        items={[
          { key: 'profile', label: t('devices.tabProfile') },
          { key: 'history', label: t('devices.tabHistory') },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t('devices.title')}
      />

      <TabPanel tabKey={tab}>
        {tab === 'profile' ? (
          <dl className="data-grid">
            <Item label={t('devices.status')}>
              <span className={`badge ${STATUS_TONE[item.status]}`}>
                {t(STATUS_KEY[item.status])}
              </span>
            </Item>
            <Item label={t('devices.type')}>{item.deviceTypeName}</Item>
            <Item label={t('devices.model')}>{orDash(item.model)}</Item>
            <Item label={t('devices.serial')}>
              <span className="mono">{orDash(item.serial)}</span>
            </Item>
            <Item label={t('devices.site')}>{orDash(item.siteCode)}</Item>
            <Item label={t('devices.cabinet')}>{orDash(item.cabinetCode)}</Item>
            <Item label={t('devices.assignedTo')}>{orDash(item.assignedTo)}</Item>
            <Item label={t('devices.department')}>{orDash(item.department)}</Item>
            <Item label={t('devices.vendor')}>{orDash(item.vendorName)}</Item>
            <Item label={t('devices.purchaseDate')}>{orDash(formatDate(item.purchaseDate))}</Item>
            <Item label={t('devices.warrantyStart')}>{orDash(formatDate(item.warrantyStart))}</Item>
            <Item label={t('devices.warrantyEnd')}>
              {item.warrantyEnd ? (
                <>
                  {formatDate(item.warrantyEnd)} <ExpiryBadge end={item.warrantyEnd} />
                </>
              ) : (
                '—'
              )}
            </Item>
            <Item label={t('devices.note')}>{orDash(item.note)}</Item>
          </dl>
        ) : history.isLoading ? (
          <Loading />
        ) : history.isError ? (
          <LoadError onRetry={() => void history.refetch()} />
        ) : (
          <HistoryPanel entries={toHistoryEntries(history.data ?? [])} />
        )}
      </TabPanel>

      {editing ? (
        <DeviceForm
          device={item}
          lists={lists.data}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="data-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
