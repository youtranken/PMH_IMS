import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDate, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { HistoryPanel } from '@/ui/history-panel';
import { LoadError, Loading, NotFound } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { TabPanel, Tabs } from '@/ui/tabs';
import { VaultPanel } from '@/ui/vault-panel';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import type { CatalogLists } from '@/features/catalog/catalog-types';
import { DeviceForm } from './device-form';
import { toHistoryEntries } from './device-history-entries';
import { PortMapPanel } from './port-map-panel';
import {
  STATUS_KEY,
  STATUS_TONE,
  locationLabel,
  type DeviceHistoryRow,
  type DeviceRow,
} from './device-types';

/** Khu mở rộng do module khác đóng góp (Epic 3/4/5) — Đợt 1 luôn rỗng. */
interface DevicePanel {
  key: string;
  title: string;
  items: { label: string; value: string; link?: string; tone?: string }[];
  emptyText?: string;
}

/**
 * Trang chi tiết thiết bị tổng hợp (story 2.5, FR-001/002/006/007).
 *
 * Mở một trang thấy đủ: hồ sơ, tình trạng bảo hành, port map, giấy tờ, lịch sử.
 * Các khu IP · license · secret · phiếu đến từ `/devices/:id/panels` — module nào đăng ký
 * thì hiện, chưa có thì mảng rỗng và trang ẩn gọn, KHÔNG lỗi, không phụ thuộc tương lai.
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

  const panels = useQuery({
    queryKey: ['devices', id, 'panels'],
    queryFn: () => apiFetch<DevicePanel[]>(`/api/v1/devices/${id}/panels`),
    enabled: device.isSuccess,
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
    // 404 = thiết bị không tồn tại → trang 404 tử tế, không phải khối lỗi đỏ "thử lại".
    return device.error instanceof ApiError && device.error.status === 404 ? (
      <NotFound />
    ) : (
      <LoadError onRetry={() => void device.refetch()} />
    );
  }

  const item = device.data!;
  const retired = item.status === 'retired';
  /**
   * Tab Két sắt hiện cho MỌI vai kể từ story 6.3.
   *
   * Trước đây chỉ SA/Admin thấy. Nhưng Member giờ có thể được whitelist hoặc xin duyệt, và
   * quyền đó nằm ở ma trận 6.2 — client không tự suy ra được từ vai. Ẩn tab theo vai thì
   * người đã được gán quyền lại không có đường nào tới. Panel tự nói rõ tầng của người xem.
   */
  const canVault = true;
  /** Ghi vào két vẫn chỉ SA/Admin — API chặn, UI đừng bày ra nút để bấm rồi 403. */
  const canVaultWrite = me.role === 'sa' || me.role === 'admin';

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

      {/* Dải tóm tắt: thứ cần biết trong 2 giây khi đang đứng xử lý sự cố. */}
      <div className="device-summary">
        <span className={`badge ${STATUS_TONE[item.status]}`}>{t(STATUS_KEY[item.status])}</span>
        <ExpiryBadge end={item.warrantyEnd} />
        <span className="muted">
          {t('devices.location')}: <span className="mono">{locationLabel(item)}</span>
        </span>
        {item.assignedTo ? (
          <span className="muted">
            {t('devices.assignedTo')}: {item.assignedTo}
          </span>
        ) : null}
      </div>

      {retired ? <p className="alert">{t('devices.retiredLocked')}</p> : null}

      <Tabs
        items={[
          { key: 'profile', label: t('devices.tabProfile') },
          // Tab Port map CHỈ hiện với loại có port (FR-006) — bảng port của một cái máy in
          // là chỗ trống vô nghĩa.
          ...(item.hasPortMap ? [{ key: 'ports', label: t('devices.tabPortMap') }] : []),
          { key: 'attachments', label: t('devices.tabAttachments') },
          // Két sắt chỉ hiện với người có quyền — Member không có đường tới endpoint (AD-9),
          // hiện tab rồi báo 403 chỉ tổ làm người ta tưởng hệ thống hỏng.
          ...(canVault ? [{ key: 'vault', label: t('vault.tab') }] : []),
          { key: 'history', label: t('devices.tabHistory') },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t('devices.title')}
      />

      <TabPanel tabKey={tab}>
        {tab === 'profile' ? (
          <>
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
              <Item label={t('devices.warrantyStart')}>
                {orDash(formatDate(item.warrantyStart))}
              </Item>
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

            <ExtensionPanels panels={panels.data ?? []} />
          </>
        ) : tab === 'ports' ? (
          <PortMapPanel device={item} csrfToken={me.csrfToken} canEdit={!retired} />
        ) : tab === 'vault' ? (
          <VaultPanel
            ownerType="device"
            ownerId={item.id}
            me={me}
            /* Ghi vào két là việc của SA/Admin. Member giờ MỞ được tab (story 6.3) nên
               phải chặn ở đây — không thì họ thấy "Cất secret"/"Xoay"/"Xóa" và bấm vào
               là 403 (code review Epic 6, finding 3). */
            canEdit={canVaultWrite && !retired}
          />
        ) : tab === 'attachments' ? (
          <AttachmentPanel
            ownerType="device"
            ownerId={item.id}
            csrfToken={me.csrfToken}
            /* Thiết bị đã thanh lý: hồ sơ khóa lại thì giấy tờ cũng chỉ còn đọc/tải. */
            canEdit={!retired}
          />
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

/**
 * Khu mở rộng. Rỗng thì KHÔNG render gì cả — không có tiêu đề "Địa chỉ IP" treo lơ lửng,
 * cũng không có dòng "tính năng sẽ có ở epic sau". Người dùng Đợt 1 không cần biết Đợt 2.
 */
function ExtensionPanels({ panels }: { panels: DevicePanel[] }) {
  if (panels.length === 0) return null;
  return (
    <div className="device-panels">
      {panels.map((panel) => (
        <section key={panel.key} className="card device-panel">
          <h2 className="form-section-title">{panel.title}</h2>
          {panel.items.length === 0 ? (
            <p className="muted">{panel.emptyText ?? '—'}</p>
          ) : (
            <dl className="data-grid">
              {panel.items.map((entry, index) => (
                <Item key={`${panel.key}-${index}`} label={entry.label}>
                  {entry.link ? (
                    <Link to={entry.link}>{entry.value}</Link>
                  ) : entry.tone ? (
                    <span className={`badge ${entry.tone}`}>{entry.value}</span>
                  ) : (
                    entry.value
                  )}
                </Item>
              ))}
            </dl>
          )}
        </section>
      ))}
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="data-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
