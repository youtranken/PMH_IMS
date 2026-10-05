import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { rejectionText, screenAttachments, useAttachmentLimits } from '@/ui/attachment-limits';
import { DetailSection } from '@/ui/detail-layout';
import { useToast } from '@/ui/toast';
import { devicePhotosKey, type DevicePhotos } from './device-photos-panel';

type Side = 'front' | 'back';
const SIDES: Side[] = ['front', 'back'];
/** Ảnh cho sơ đồ: JPG/PNG — bộ vẽ ảnh của server không giải mã WebP. */
const PHOTO_ACCEPT = '.jpg,.jpeg,.png';

/**
 * Mức ảnh đang dùng của một mặt. Thứ tự tra (riêng của máy → chung của model → biểu tượng loại)
 * là của SERVER (`effective` của `GET /devices/:id/photos`); web chỉ nói ra mức nào đang thắng.
 */
export function lookLevel(photos: DevicePhotos | undefined, side: Side): 'own' | 'model' | 'icon' {
  const effective = photos?.effective[side];
  if (!effective) return 'icon';
  return photos?.device[side]?.id === effective.id ? 'own' : 'model';
}

/**
 * Khu "Hình dùng trên sơ đồ" ở tab Tổng quan (Q-23 05/10): mỗi máy đổi được ảnh của riêng nó, tải
 * THẲNG từng mặt (ảnh lên giấy tờ của máy rồi chọn làm ảnh riêng — cùng đường, cùng giới hạn cỡ và
 * cùng lượt kiểm nội dung của giấy tờ). Ảnh model đổi hình của cả loạt máy nên chỉ SA/Admin.
 */
export function DeviceDiagramLook({
  deviceId,
  deviceTypeName,
  csrfToken,
  canEdit,
  canEditModel,
}: {
  deviceId: string;
  deviceTypeName: string | null;
  csrfToken: string;
  /** Hồ sơ còn sửa được (chưa thanh lý). */
  canEdit: boolean;
  /** SA/Admin — đổi ảnh dùng chung cho mọi máy cùng model. */
  canEditModel: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const limits = useAttachmentLimits();
  const photos = useQuery({ queryKey: devicePhotosKey(deviceId), queryFn: () => apiFetch<DevicePhotos>(`/api/v1/devices/${deviceId}/photos`) });
  const [busy, setBusy] = useState(false);
  const data = photos.data;
  const modelLabel = data?.model?.label ?? null;
  const sideLabel = (side: Side) => t(side === 'front' ? 'devices.photoFront' : 'devices.photoBack');

  const run = async (work: () => Promise<DevicePhotos>, message: string) => {
    setBusy(true);
    try {
      queryClient.setQueryData(devicePhotosKey(deviceId), await work());
      // Ảnh chọn từ giấy tờ: danh sách giấy tờ của máy / model đổi theo.
      void queryClient.invalidateQueries({ queryKey: ['files'] });
      toast({ tone: 'ok', message });
    } catch (error) {
      toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const screened = (file: File | undefined): File | null => {
    if (!file) return null;
    const result = screenAttachments([file], limits);
    const rejected = rejectionText(t, result, limits);
    if (rejected) toast({ tone: 'error', message: rejected });
    return result.accepted[0] ?? null;
  };

  const uploadOwn = (side: Side, file: File) =>
    run(async () => {
      const saved = await uploadFile<{ id: string }>('/api/v1/files', file, csrfToken, { ownerType: 'device', ownerId: deviceId });
      return apiFetch<DevicePhotos>(`/api/v1/devices/${deviceId}/photos`, { method: 'PATCH', csrfToken, body: JSON.stringify({ [side]: saved.id }) });
    }, t('devices.lookOwnSaved', { side: sideLabel(side) }));

  const removeOwn = (side: Side) =>
    run(
      () => apiFetch<DevicePhotos>(`/api/v1/devices/${deviceId}/photos`, { method: 'PATCH', csrfToken, body: JSON.stringify({ [side]: null }) }),
      t('devices.lookOwnRemoved', { side: sideLabel(side) }),
    );

  const uploadModel = (side: Side, file: File) =>
    run(async () => {
      const model = await apiFetch<{ id: string }>(`/api/v1/devices/${deviceId}/model`, { method: 'POST', csrfToken });
      const saved = await uploadFile<{ id: string }>('/api/v1/files', file, csrfToken, { ownerType: 'device_model', ownerId: model.id });
      return apiFetch<DevicePhotos>(`/api/v1/devices/${deviceId}/model-photos`, { method: 'PATCH', csrfToken, body: JSON.stringify({ [side]: saved.id }) });
    }, t('devices.lookModelSaved', { model: modelLabel ?? '' }));

  const levelText = (side: Side) => {
    const level = lookLevel(data, side);
    if (level === 'own') return t('devices.lookOwn');
    if (level === 'model') return t('devices.lookModel', { model: modelLabel ?? '' });
    return t('devices.lookIcon', { type: deviceTypeName ?? '' });
  };

  return (
    <DetailSection title={t('devices.lookTitle')} compact>
      <p className="muted small">{t('devices.lookHint')}</p>
      {photos.isError ? (
        <p className="alert error" role="alert">
          {errorMessage(photos.error)}
        </p>
      ) : null}
      <div className="device-look">
        {SIDES.map((side) => {
          const effective = data?.effective[side] ?? null;
          const own = Boolean(data?.device[side]);
          const label = sideLabel(side);
          return (
            <div key={side} className="device-look-side" role="group" aria-label={label}>
              <strong>{label}</strong>
              {effective ? (
                <img
                  src={`/api/v1/devices/${deviceId}/photo/${side}?v=${effective.id}`}
                  alt={t('devices.photoAlt', { side: label })}
                  className="device-look-img"
                />
              ) : null}
              <span className="muted small">{data ? levelText(side) : '…'}</span>
              {canEdit && data ? (
                <span className="device-look-actions">
                  <label className="btn sm">
                    {t(own ? 'devices.lookReplaceOwn' : 'devices.lookUploadOwn')}
                    <input
                      type="file"
                      accept={PHOTO_ACCEPT}
                      hidden
                      disabled={busy}
                      aria-label={t('devices.lookUploadOwnOf', { side: label })}
                      onChange={(event) => {
                        const file = screened(event.target.files?.[0]);
                        event.target.value = '';
                        if (file) void uploadOwn(side, file);
                      }}
                    />
                  </label>
                  {own ? (
                    <button type="button" className="btn sm ghost" disabled={busy} aria-label={t('devices.lookRemoveOwnOf', { side: label })} onClick={() => void removeOwn(side)}>
                      {t('devices.lookRemoveOwn')}
                    </button>
                  ) : null}
                  {canEditModel && modelLabel ? (
                    <label className="btn sm ghost">
                      {t('devices.lookUploadModel')}
                      <input
                        type="file"
                        accept={PHOTO_ACCEPT}
                        hidden
                        disabled={busy}
                        aria-label={t('devices.lookUploadModelOf', { side: label })}
                        onChange={(event) => {
                          const file = screened(event.target.files?.[0]);
                          event.target.value = '';
                          if (file) void uploadModel(side, file);
                        }}
                      />
                    </label>
                  ) : null}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {data && !data.model ? <p className="muted small">{t('devices.photoNoModel')}</p> : null}
    </DetailSection>
  );
}
