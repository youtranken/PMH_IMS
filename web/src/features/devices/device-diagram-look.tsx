import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { deviceModelPhotoSrc, type DeviceModel } from '@/lib/device-models';
import { errorMessage } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { DetailSection } from '@/ui/detail-layout';
import {
  DevicePhotoSlots,
  PHOTO_SIDES,
  useDeviceTypeIconSrc,
  type PhotoSide,
  type PhotoSlot,
} from '@/ui/device-photo-slots';
import { InfoTip } from '@/ui/info-tip';
import { useToast } from '@/ui/toast';
import { devicePhotosKey, type DevicePhotos } from './device-photos-panel';

/**
 * Mức ảnh đang dùng của một mặt. Thứ tự tra (riêng của máy → chung của model → biểu tượng loại)
 * là của SERVER (`effective` của `GET /devices/:id/photos`); web chỉ nói ra mức nào đang thắng.
 */
export function lookLevel(photos: DevicePhotos | undefined, side: PhotoSide): 'own' | 'model' | 'icon' {
  const effective = photos?.effective[side];
  if (!effective) return 'icon';
  return photos?.device[side]?.id === effective.id ? 'own' : 'model';
}

export const devicePhotoSrc = (deviceId: string, side: PhotoSide, fileId: string) =>
  `/api/v1/devices/${deviceId}/photo/${side}?v=${fileId}`;

/** Tệp gốc của một ảnh (giấy tờ của máy hay của model) — để cắt lại hoặc chép sang model. */
export async function downloadPhotoFile(file: { id: string; name: string }, failText: string): Promise<File> {
  const response = await fetch(`/api/v1/files/${file.id}/download`, { credentials: 'include' });
  if (!response.ok) throw new Error(failText);
  const blob = await response.blob();
  return new File([blob], file.name, { type: /\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg' });
}

/** Tải ảnh lên giấy tờ của máy rồi chọn làm ảnh riêng — một đường cho trang thiết bị và form. */
export async function setOwnPhotos(
  deviceId: string,
  files: Partial<Record<PhotoSide, File>>,
  csrfToken: string,
): Promise<DevicePhotos> {
  const chosen: Partial<Record<PhotoSide, string>> = {};
  for (const side of PHOTO_SIDES) {
    const file = files[side];
    if (!file) continue;
    const saved = await uploadFile<{ id: string }>('/api/v1/files', file, csrfToken, { ownerType: 'device', ownerId: deviceId });
    chosen[side] = saved.id;
  }
  return apiFetch<DevicePhotos>(`/api/v1/devices/${deviceId}/photos`, { method: 'PATCH', csrfToken, body: JSON.stringify(chosen) });
}

/**
 * Ô ảnh hai mặt của một máy ĐÃ CÓ id, ghi thẳng (Q-23): ảnh riêng tải lên giấy tờ của máy rồi chọn
 * làm ảnh riêng (cùng đường, cùng giới hạn cỡ và cùng lượt kiểm nội dung của giấy tờ). Ảnh model
 * đổi hình của cả loạt máy nên chỉ SA/Admin. Trang thiết bị và form Sửa dùng chung.
 */
export function DevicePhotoEditor({
  deviceId,
  deviceTypeId,
  deviceTypeName,
  csrfToken,
  canEdit,
  canEditModel,
  rackUnits = null,
  pendingModel,
}: {
  /**
   * Model vừa chọn trên form Sửa mà CHƯA lưu (`undefined` = form vẫn giữ model cũ). Ô ảnh xem trước
   * theo model đó ngay, và tắt việc ghi ảnh chung — lúc này ghi là ghi vào model cũ.
   */
  pendingModel?: DeviceModel | null;
  /** Số U của máy — hộp cắt khoá khung theo mặt tủ n U. */
  rackUnits?: number | null;
  deviceId: string;
  deviceTypeId: string | null;
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
  const typeIconSrc = useDeviceTypeIconSrc(deviceTypeId);
  const photos = useQuery({ queryKey: devicePhotosKey(deviceId), queryFn: () => apiFetch<DevicePhotos>(`/api/v1/devices/${deviceId}/photos`) });
  const [busySide, setBusySide] = useState<PhotoSide | null>(null);
  const [errors, setErrors] = useState<Partial<Record<PhotoSide, string | null>>>({});
  const [savedKey, setSavedKey] = useState<Partial<Record<PhotoSide, number>>>({});
  // Chỉ dùng câu trả lời đúng hình: ô ảnh vỡ cả form nếu đọc `effective` của một câu trả lời lạ.
  const data = photos.data?.effective ? photos.data : undefined;
  const pending = pendingModel !== undefined;
  const modelLabel = pending ? (pendingModel?.model ?? null) : (data?.model?.label ?? null);
  const sideLabel = (side: PhotoSide) => t(side === 'front' ? 'photoSlots.front' : 'photoSlots.back');

  const run = async (side: PhotoSide, work: () => Promise<DevicePhotos>, message: string) => {
    setBusySide(side);
    setErrors((current) => ({ ...current, [side]: null }));
    try {
      queryClient.setQueryData(devicePhotosKey(deviceId), await work());
      // Ảnh tải lên là giấy tờ của máy / model: danh sách giấy tờ đổi theo.
      void queryClient.invalidateQueries({ queryKey: ['files'] });
      setSavedKey((current) => ({ ...current, [side]: (current[side] ?? 0) + 1 }));
      toast({ tone: 'ok', message });
    } catch (error) {
      setErrors((current) => ({ ...current, [side]: errorMessage(error) }));
    } finally {
      setBusySide(null);
    }
  };

  const uploadModel = (side: PhotoSide, file: File) =>
    run(side, async () => {
      const model = await apiFetch<{ id: string }>(`/api/v1/devices/${deviceId}/model`, { method: 'POST', csrfToken });
      const saved = await uploadFile<{ id: string }>('/api/v1/files', file, csrfToken, { ownerType: 'device_model', ownerId: model.id });
      return apiFetch<DevicePhotos>(`/api/v1/devices/${deviceId}/model-photos`, { method: 'PATCH', csrfToken, body: JSON.stringify({ [side]: saved.id }) });
    }, t('devices.lookModelSaved', { model: modelLabel ?? '' }));

  /*
   * Ảnh model phải là tệp CỦA model (server kiểm chủ tệp), nên "dùng ảnh này" là tải lại đúng
   * tệp ảnh riêng làm tệp của model — server kiểm nội dung lần nữa như mọi lượt tải lên.
   */
  const copyOwnToModel = (side: PhotoSide) => {
    const own = data?.device[side];
    if (!own) return;
    void run(side, async () => {
      const file = await downloadPhotoFile(own, t('devices.lookCopyFailed'));
      const model = await apiFetch<{ id: string }>(`/api/v1/devices/${deviceId}/model`, { method: 'POST', csrfToken });
      const saved = await uploadFile<{ id: string }>('/api/v1/files', file, csrfToken, { ownerType: 'device_model', ownerId: model.id });
      return apiFetch<DevicePhotos>(`/api/v1/devices/${deviceId}/model-photos`, { method: 'PATCH', csrfToken, body: JSON.stringify({ [side]: saved.id }) });
    }, t('devices.lookModelSaved', { model: modelLabel ?? '' }));
  };

  const slot = (side: PhotoSide): PhotoSlot => {
    if (pending) {
      if (side === 'front' && pendingModel?.photoFrontFileId) return { src: deviceModelPhotoSrc(pendingModel.id, pendingModel.updatedAt), level: 'model' };
      const own = data?.device[side];
      return own ? { src: devicePhotoSrc(deviceId, side, own.id), level: 'own' } : { src: null, level: 'icon' };
    }
    const effective = data?.effective[side];
    return { src: effective ? devicePhotoSrc(deviceId, side, effective.id) : null, level: lookLevel(data, side) };
  };

  return (
    <>
      {photos.isError ? (
        <p className="alert error" role="alert">
          {errorMessage(photos.error)}
        </p>
      ) : null}
      <DevicePhotoSlots
        slots={{ front: slot('front'), back: slot('back') }}
        typeName={deviceTypeName}
        typeIconSrc={typeIconSrc}
        modelLabel={modelLabel}
        readOnly={!canEdit || !data}
        busySide={busySide}
        savedKey={savedKey}
        errors={errors}
        onPick={(side, file) => void run(side, () => setOwnPhotos(deviceId, { [side]: file }, csrfToken), t('devices.lookOwnSaved', { side: sideLabel(side) }))}
        onRemove={(side) =>
          void run(
            side,
            () => apiFetch<DevicePhotos>(`/api/v1/devices/${deviceId}/photos`, { method: 'PATCH', csrfToken, body: JSON.stringify({ [side]: null }) }),
            t('devices.lookOwnRemoved', { side: sideLabel(side) }),
          )
        }
        model={canEditModel && !pending ? { onUpload: (side, file) => void uploadModel(side, file), onCopyOwn: copyOwnToModel } : null}
        rackUnits={rackUnits}
        loadOriginal={(side) => {
          const effective = data?.effective[side];
          return effective ? downloadPhotoFile(effective, t('photoSlots.recropFailed')) : Promise.reject(new Error('none'));
        }}
      />
      {data && !data.model ? <p className="muted small">{t('devices.photoNoModel')}</p> : null}
    </>
  );
}

/**
 * Khu "Hình dùng trên sơ đồ" ở tab Tổng quan của trang thiết bị. Việc thỉnh thoảng mới làm nên gập
 * sẵn (Q-27 bổ sung): dòng tiêu đề nói mỗi mặt đang dùng ảnh gì, đủ để biết có cần mở không; lời
 * giải thích thứ tự ảnh nằm trong nút (i).
 */
export function DeviceDiagramLook(props: Parameters<typeof DevicePhotoEditor>[0]) {
  const { t } = useTranslation();
  // Cùng khoá với `DevicePhotoEditor` (và bản đồ quan hệ): không phải lượt gọi thứ hai.
  const photos = useQuery({
    queryKey: devicePhotosKey(props.deviceId),
    queryFn: () => apiFetch<DevicePhotos>(`/api/v1/devices/${props.deviceId}/photos`),
  });
  const data = photos.data?.effective ? photos.data : undefined;
  const levelText = (side: PhotoSide) => {
    const level = lookLevel(data, side);
    if (level === 'own') return t('photoSlots.levelOwn');
    if (level === 'model') return t('photoSlots.levelModel', { model: data?.model?.label ?? '' });
    return props.deviceTypeName ? t('photoSlots.levelIcon', { type: props.deviceTypeName }) : t('photoSlots.levelIconNoType');
  };
  const summary = data
    ? PHOTO_SIDES.map((side) => `${t(side === 'front' ? 'photoSlots.front' : 'photoSlots.back')}: ${levelText(side)}`).join(' · ')
    : null;
  return (
    <DetailSection
      title={t('devices.lookTitle')}
      compact
      foldable={{ summary }}
      action={<InfoTip subject={t('devices.lookTitle')}>{t('devices.lookHint')}</InfoTip>}
    >
      <DevicePhotoEditor {...props} />
    </DetailSection>
  );
}

export interface DevicePhotoDraft {
  files: Partial<Record<PhotoSide, File>>;
  previews: Partial<Record<PhotoSide, string>>;
  set: (side: PhotoSide, file: File | null) => void;
  /**
   * Tải ảnh đang giữ lên máy VỪA TẠO rồi đặt làm ảnh riêng. KHÔNG ném lỗi (cùng hợp đồng với
   * `useAttachmentDraft`): máy đã ghi xuống DB, ném ra là màn hình báo "lưu thất bại" trong khi
   * máy vẫn nằm đó. Trả câu lỗi (hoặc `null`) để nơi gọi báo riêng kèm đường đặt lại.
   */
  upload: (deviceId: string, csrfToken: string) => Promise<string | null>;
}

/** Ảnh chọn trong form THÊM MỚI, khi máy chưa có id: giữ `File` + ảnh xem trước ở trình duyệt. */
export function useDevicePhotoDraft(): DevicePhotoDraft {
  const [files, setFiles] = useState<Partial<Record<PhotoSide, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<PhotoSide, string>>>({});
  // `upload` chạy trong `onSuccess` của lượt lưu — closure của lượt render trước; ref luôn mới nhất.
  const latest = useRef(files);
  latest.current = files;
  const urls = useRef(previews);
  urls.current = previews;
  useEffect(() => () => Object.values(urls.current).forEach((url) => url && URL.revokeObjectURL(url)), []);

  const set = (side: PhotoSide, file: File | null) => {
    const old = urls.current[side];
    if (old) URL.revokeObjectURL(old);
    const nextFiles = { ...latest.current };
    const nextPreviews = { ...urls.current };
    if (file) {
      nextFiles[side] = file;
      nextPreviews[side] = URL.createObjectURL(file);
    } else {
      delete nextFiles[side];
      delete nextPreviews[side];
    }
    latest.current = nextFiles;
    urls.current = nextPreviews;
    setFiles(nextFiles);
    setPreviews(nextPreviews);
  };

  return {
    files,
    previews,
    set,
    upload: async (deviceId, csrfToken) => {
      const held = latest.current;
      if (!held.front && !held.back) return null;
      try {
        await setOwnPhotos(deviceId, held, csrfToken);
        return null;
      } catch (error) {
        return errorMessage(error);
      } finally {
        // Ảnh thuộc về máy vừa tạo; "Lưu và nhân bản" không được mang nó sang máy kế tiếp.
        PHOTO_SIDES.forEach((side) => set(side, null));
      }
    },
  };
}
