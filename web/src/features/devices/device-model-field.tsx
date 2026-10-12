import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { DEVICE_MODELS_KEY, deviceModelParts, deviceModelPhotoSrc, type DeviceModel } from '@/lib/device-models';
import { Combobox } from '@/ui/combobox';
import { DeviceModelDialog } from '@/ui/device-model-dialog';
import { useDebouncedValue } from '@/ui/use-debounced-value';

const SUGGEST_LIMIT = 10;

/**
 * Ô Model của form thiết bị (Q-26 QT-1: thiết bị trước, model tạo tại chỗ). Gõ để tìm theo khoá
 * chuẩn hoá ("c9300 48" ra "C9300-48P"); chưa có thì "+ Tạo model mới" mở `DeviceModelDialog` ngay
 * trên form — không rời form, không mất chữ đang nhập.
 *
 * Gõ mà không chọn thì máy "chưa có Model": chữ gõ vẫn lưu làm chuỗi model như trước.
 */
export function DeviceModelField({
  csrfToken,
  canManage = false,
  id,
  term,
  picked,
  deviceTypeId,
  onPick,
  onTerm,
}: {
  csrfToken: string;
  /** SA/Admin: hộp tạo model mới có ô ảnh mặt trước (ảnh model đổi hình cả loạt máy). */
  canManage?: boolean;
  id?: string;
  term: string;
  picked: DeviceModel | null;
  /** Loại đang chọn trên form — điền sẵn cho model tạo mới. */
  deviceTypeId: string;
  onPick: (model: DeviceModel) => void;
  onTerm: (term: string) => void;
}) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const settled = useDebouncedValue(term);
  const search = settled.trim();
  const suggestions = useQuery({
    queryKey: [...DEVICE_MODELS_KEY, 'suggest', search],
    queryFn: () => apiFetch<{ items: DeviceModel[] }>(`/api/v1/device-models?limit=${SUGGEST_LIMIT}&search=${encodeURIComponent(search)}`),
    enabled: search.length > 0 && !picked,
  });

  return (
    <>
      <Combobox<DeviceModel>
        id={id}
        ariaLabel={t('devices.model')}
        placeholder={t('devices.modelPlaceholder')}
        query={term}
        onQuery={onTerm}
        options={picked ? [] : (suggestions.data?.items ?? [])}
        pending={suggestions.isFetching}
        failed={suggestions.isError}
        getKey={(model) => model.id}
        renderOption={(model) => {
          const parts = deviceModelParts(model);
          return (
            <>
              {/* Ảnh nhỏ để nhận đúng máy bằng mắt (Q-27). Trang trí — tên dòng vẫn là chữ. */}
              <span className={model.photoFrontFileId ? 'cell-thumb' : 'cell-thumb is-empty'} aria-hidden="true">
                {model.photoFrontFileId ? <img src={deviceModelPhotoSrc(model.id, model.updatedAt)} alt="" /> : null}
              </span>{' '}
              <span className="mono">{model.model}</span>{' '}
              <small>{[model.manufacturer, model.deviceTypeName, parts.size ?? t('deviceModels.rackNone')].filter(Boolean).join(' · ')}</small>
            </>
          );
        }}
        onSelect={onPick}
        action={
          picked
            ? undefined
            : {
                label: term.trim() ? t('devices.modelCreate', { term: term.trim() }) : t('devices.modelCreateEmpty'),
                onClick: () => setCreating(true),
              }
        }
      />
      {creating ? (
        <DeviceModelDialog
          csrfToken={csrfToken}
          canManage={canManage}
          initial={{ model: term.trim(), deviceTypeId: deviceTypeId || null }}
          onClose={() => setCreating(false)}
          onSaved={onPick}
        />
      ) : null}
    </>
  );
}
