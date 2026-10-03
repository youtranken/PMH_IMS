import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { AttachmentPanel, useOwnerAttachments } from '@/ui/attachment-panel';
import { DetailSection } from '@/ui/detail-layout';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';

type Side = 'front' | 'back';
const SIDES: Side[] = ['front', 'back'];

interface PhotoFile {
  id: string;
  name: string;
}

/** `GET /devices/:id/photos`. */
export interface DevicePhotos {
  device: Record<Side, PhotoFile | null>;
  model: ({ id: string | null; label: string } & Record<Side, PhotoFile | null>) | null;
  effective: Record<Side, PhotoFile | null>;
}

export const devicePhotosKey = (deviceId: string) => ['device-photos', deviceId];

/**
 * "Ảnh thật trên sơ đồ" (Q-23, Story 10.11): ảnh hai mặt của máy cho bản vẽ. Ảnh riêng máy chọn
 * từ giấy tờ đính kèm của chính máy và đè ảnh theo model (loại + chuỗi model, dùng chung cho mọi máy
 * cùng model). Ảnh model tải lên ở khu riêng ngay dưới. Xem trước là ảnh server đã thu nhỏ.
 */
export function DevicePhotosPanel({ deviceId, csrfToken, canEdit }: { deviceId: string; csrfToken: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const photos = useQuery({ queryKey: devicePhotosKey(deviceId), queryFn: () => apiFetch<DevicePhotos>(`/api/v1/devices/${deviceId}/photos`) });
  const deviceFiles = useOwnerAttachments('device', deviceId);
  const modelId = photos.data?.model?.id ?? null;
  const [busy, setBusy] = useState(false);

  const write = async (path: string, init: { method: string; body?: string }) => {
    setBusy(true);
    try {
      const result = await apiFetch<DevicePhotos | { id: string }>(path, { ...init, csrfToken });
      await queryClient.invalidateQueries({ queryKey: devicePhotosKey(deviceId) });
      return result;
    } catch (error) {
      toast({ tone: 'error', message: errorMessage(error) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const choose = (scope: 'device' | 'model', side: Side, fileId: string) =>
    void write(`/api/v1/devices/${deviceId}/${scope === 'device' ? 'photos' : 'model-photos'}`, {
      method: 'PATCH',
      body: JSON.stringify({ [side]: fileId || null }),
    });

  const data = photos.data;
  const sideLabel = (side: Side) => t(side === 'front' ? 'devices.photoFront' : 'devices.photoBack');
  const preview = (side: Side) => {
    const file = data?.effective[side];
    if (!file) return <span className="muted">{t('devices.photoNone')}</span>;
    const own = data?.device[side]?.id === file.id;
    return (
      <>
        <img
          src={`/api/v1/devices/${deviceId}/photo/${side}?v=${file.id}`}
          alt={t('devices.photoAlt', { side: sideLabel(side) })}
          style={{ maxWidth: '100%', maxHeight: 96, height: 'auto' }}
        />
        <span className="muted small">{t(own ? 'devices.photoFromDevice' : 'devices.photoFromModel', { name: file.name })}</span>
      </>
    );
  };

  return (
    <DetailSection title={t('devices.photosTitle')} compact>
      <p className="muted small">{t('devices.photosHint')}</p>
      {photos.isError ? (
        <p className="alert error" role="alert">
          {errorMessage(photos.error)}
        </p>
      ) : null}
      <div className="form-grid" data-columns={2}>
        {SIDES.map((side) => (
          <Field key={side} label={sideLabel(side)}>
            {preview(side)}
            <Select
              value={data?.device[side]?.id ?? ''}
              ariaLabel={t('devices.photoDevicePick', { side: sideLabel(side) })}
              placeholder={t('devices.photoUseModel')}
              disabled={!canEdit || busy || !data}
              options={[
                { value: '', label: t('devices.photoUseModel') },
                ...imageOptions(deviceFiles.data),
              ]}
              onChange={(value) => choose('device', side, value)}
            />
          </Field>
        ))}
      </div>
      {data && !data.model ? <p className="muted small">{t('devices.photoNoModel')}</p> : null}
      {data?.model ? (
        <>
          <h3 className="form-section-title">{t('devices.photoModelTitle', { model: data.model.label })}</h3>
          {modelId ? (
            <ModelPhotos
              modelId={modelId}
              chosen={{ front: data.model.front?.id ?? '', back: data.model.back?.id ?? '' }}
              csrfToken={csrfToken}
              disabled={!canEdit || busy}
              canEdit={canEdit}
              sideLabel={sideLabel}
              onChoose={(side, value) => choose('model', side, value)}
            />
          ) : canEdit ? (
            <button type="button" className="btn" disabled={busy} onClick={() => void write(`/api/v1/devices/${deviceId}/model`, { method: 'POST' })}>
              {t('devices.photoModelStart')}
            </button>
          ) : (
            <p className="muted small">{t('devices.photoNone')}</p>
          )}
        </>
      ) : null}
    </DetailSection>
  );
}

function imageOptions(files: { id: string; originalName: string; kind: string }[] | undefined) {
  return (files ?? []).filter((f) => f.kind === 'image').map((f) => ({ value: f.id, label: f.originalName }));
}

/** Ảnh theo model: chọn mặt từ ảnh đã tải cho model, khu tải ảnh model ngay dưới (cùng cache giấy tờ). */
function ModelPhotos({
  modelId,
  chosen,
  csrfToken,
  disabled,
  canEdit,
  sideLabel,
  onChoose,
}: {
  modelId: string;
  chosen: Record<Side, string>;
  csrfToken: string;
  disabled: boolean;
  canEdit: boolean;
  sideLabel: (side: Side) => string;
  onChoose: (side: Side, fileId: string) => void;
}) {
  const { t } = useTranslation();
  const files = useOwnerAttachments('device_model', modelId);
  return (
    <>
      <div className="form-grid" data-columns={2}>
        {SIDES.map((side) => (
          <Field key={side} label={sideLabel(side)}>
            <Select
              value={chosen[side]}
              ariaLabel={t('devices.photoModelPick', { side: sideLabel(side) })}
              placeholder={t('devices.photoNoneOption')}
              disabled={disabled}
              options={[{ value: '', label: t('devices.photoNoneOption') }, ...imageOptions(files.data)]}
              onChange={(value) => onChoose(side, value)}
            />
          </Field>
        ))}
      </div>
      <AttachmentPanel ownerType="device_model" ownerId={modelId} csrfToken={csrfToken} canEdit={canEdit} />
    </>
  );
}
