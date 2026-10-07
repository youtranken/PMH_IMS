/** Một model trong Danh mục Model thiết bị (`GET /api/v1/device-models`, Q-26). */
export interface DeviceModel {
  id: string;
  deviceTypeId: string;
  deviceTypeName: string;
  model: string;
  manufacturer: string | null;
  rackMountable: boolean;
  uSize: number | null;
  photoFrontFileId: string | null;
  /** Cổng mẫu (nhóm `pattern` + `kind`) và số cổng nó sinh ra. */
  portTemplate: { pattern: string; kind: 'rj45' | 'sfp' | 'sfp+' | 'console' | 'other' }[];
  portCount: number;
  /** Số máy đang trỏ tới model. */
  deviceCount: number;
  updatedAt: string;
}

export const DEVICE_MODELS_KEY = ['device-models'] as const;

/** Ảnh mặt trước của model; `version` (thường là `updatedAt`) đổi thì trình duyệt tải lại ảnh. */
export function deviceModelPhotoSrc(modelId: string, version: string): string {
  return `/api/v1/device-models/${modelId}/photo/front?v=${encodeURIComponent(version)}`;
}

/**
 * Khoá chuẩn hoá của model — cùng phép với `modelKey()` của api và cột `device_model.model_key`:
 * viết HOA, bỏ khoảng trắng, gạch ngang, gạch dưới, chấm. Gợi ý ở ô Model so bằng khoá này để
 * "c9300 48" ra "C9300-48P".
 */
export function modelKey(model: string): string {
  return model.replace(/[\s_.-]/g, '').toUpperCase();
}

/** Nhãn một dòng của model: "Cisco · C9300-48P · 1U" / "HP · LaserJet M404 · không gắn tủ". */
export function deviceModelParts(model: Pick<DeviceModel, 'manufacturer' | 'model' | 'rackMountable' | 'uSize'>): { head: string; size: string | null } {
  return {
    head: [model.manufacturer, model.model].filter(Boolean).join(' · '),
    size: model.rackMountable && model.uSize ? `${model.uSize}U` : null,
  };
}
