import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { measurePhotoFit } from '@/lib/image-crop';
import { rejectionText, screenAttachments, useAttachmentLimits } from '@/ui/attachment-limits';
import { FilePicker } from '@/ui/file-picker';
import { DeviceIcon } from '@/ui/glyph-icons';
import { ImageCropDialog } from '@/ui/image-crop-dialog';

export type PhotoSide = 'front' | 'back';
export const PHOTO_SIDES: PhotoSide[] = ['front', 'back'];

/** Ảnh cho sơ đồ: JPG/PNG — bộ vẽ ảnh của server không giải mã WebP. */
export const PHOTO_ACCEPT = '.jpg,.jpeg,.png';

/**
 * Hình một mặt đang dùng: `own` ảnh riêng của máy, `model` ảnh chung của model, `icon` biểu tượng
 * loại, `draft` ảnh đã chọn trong form thêm mới (chưa tải lên), `unset` form thêm mới chưa chọn.
 */
export type PhotoLevel = 'own' | 'model' | 'icon' | 'draft' | 'unset';

export interface PhotoSlot {
  src: string | null;
  level: PhotoLevel;
}

export interface ModelPhotoActions {
  /** Tải một ảnh mới làm ảnh chung của model. */
  onUpload: (side: PhotoSide, file: File) => void;
  /** Lấy chính ảnh riêng đang hiện làm ảnh chung của model. */
  onCopyOwn: (side: PhotoSide) => void;
}

/** Trình duyệt Windows đôi khi gửi `type` rỗng: xét cả đuôi tên tệp. */
function isPhoto(file: File): boolean {
  if (file.type === 'image/jpeg' || file.type === 'image/png') return true;
  return !file.type && /\.(jpe?g|png)$/i.test(file.name);
}

/**
 * Biểu tượng SVG riêng của loại (Danh mục) làm `data:` URI cho `<img>` — ảnh SVG không chạy
 * script, nên không chèn thẳng SVG vào DOM. Cùng khoá cache với màn Danh mục.
 */
export function useDeviceTypeIconSrc(typeId: string | null | undefined): string | null {
  const icon = useQuery({
    queryKey: ['catalog', 'device-type-icon', typeId],
    queryFn: () => apiFetch<{ svg: string | null }>(`/api/v1/catalog/device-types/${typeId}/diagram-icon`),
    enabled: Boolean(typeId),
  });
  const svg = icon.data?.svg ?? null;
  return svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : null;
}

/**
 * Hai ô ảnh "Mặt trước" / "Mặt sau" của một thiết bị (Q-23, AD-15): trang thiết bị và form Thêm/Sửa
 * dùng chung. Mỗi ô hiện ĐÚNG hình đang dùng (ảnh, hoặc biểu tượng loại phóng to), nhãn mức đang
 * dùng, và cả ô là vùng thả. Ô KHÔNG tự gửi gì: lọc loại + cỡ (cùng trần giấy tờ, Q-18), mở hộp
 * cắt (Q-23 — khoá theo mặt tủ khi có `rackUnits`) rồi trả `File` ĐÃ CẮT cho nơi gọi — trang
 * chi tiết tải thẳng, form thêm mới giữ lại tới lúc máy có id. Ảnh đang hiện còn viền hay lệch tỉ lệ
 * n U thì ô báo "Cắt lại" (cần `loadOriginal` để lấy tệp gốc).
 */
export function DevicePhotoSlots({
  slots,
  typeName,
  typeIconSrc = null,
  modelLabel,
  readOnly = false,
  busySide = null,
  savedKey,
  errors,
  onPick,
  onRemove,
  model = null,
  rackUnits = null,
  loadOriginal,
}: {
  slots: Record<PhotoSide, PhotoSlot>;
  typeName: string | null;
  typeIconSrc?: string | null;
  modelLabel: string | null;
  /** Máy thanh lý: chỉ xem. */
  readOnly?: boolean;
  /** Mặt đang tải lên — khoá cả hai mặt (một lượt ghi một lúc) và báo trong ô đó. */
  busySide?: PhotoSide | null;
  /** Tăng sau mỗi lần ghi xong của một mặt → ô đó loé xanh. */
  savedKey?: Partial<Record<PhotoSide, number>>;
  /** Lỗi của lượt ghi gần nhất theo mặt (nơi gọi đặt). */
  errors?: Partial<Record<PhotoSide, string | null>>;
  onPick?: (side: PhotoSide, file: File) => void;
  onRemove?: (side: PhotoSide) => void;
  /** Chỉ truyền cho SA/Admin và khi máy có model — ảnh chung đổi hình của cả loạt máy. */
  model?: ModelPhotoActions | null;
  /** Số U của máy: khung cắt khoá theo mặt tủ n U; vắng/0 = cắt tự do. */
  rackUnits?: number | null;
  /** Tệp gốc của ảnh đang hiện ở một mặt — có thì ảnh chưa cắt chuẩn được "Cắt lại". */
  loadOriginal?: (side: PhotoSide) => Promise<File>;
}) {
  const { t } = useTranslation();
  const limits = useAttachmentLimits();
  const [rejected, setRejected] = useState<Partial<Record<PhotoSide, string | null>>>({});
  // Đổi `key` sau mỗi lượt chọn: `<input>` giữ giá trị cũ thì chọn lại đúng tệp đó không bắn onChange.
  const [picks, setPicks] = useState(0);
  const modelInputs = useRef<Partial<Record<PhotoSide, HTMLInputElement | null>>>({});
  const busy = busySide !== null;
  // Tệp đang cắt: `to` = ảnh riêng (onPick) hay ảnh chung của model (model.onUpload).
  const [cropping, setCropping] = useState<{ side: PhotoSide; file: File; to: 'own' | 'model' } | null>(null);
  const [misfit, setMisfit] = useState<Partial<Record<PhotoSide, 'margins' | 'aspect' | null>>>({});
  const images = useRef<Partial<Record<PhotoSide, HTMLImageElement | null>>>({});
  const units = rackUnits && rackUnits > 0 ? rackUnits : null;

  /** `loaded` = gọi từ `onLoad`; lượt đo lại khi đổi Số U chỉ đo ảnh đã nạp xong. */
  const measure = (side: PhotoSide, loaded = false) => {
    const img = images.current[side];
    if (!img || (!loaded && !img.complete)) return;
    const issue = measurePhotoFit(img, units);
    setMisfit((current) => (current[side] === issue ? current : { ...current, [side]: issue }));
  };
  // Đổi Số U sau khi ảnh đã nạp: đo lại theo n mới.
  useEffect(() => {
    PHOTO_SIDES.forEach((side) => measure(side));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units]);

  const recrop = async (side: PhotoSide, level: PhotoLevel) => {
    if (!loadOriginal) return;
    try {
      const file = await loadOriginal(side);
      setCropping({ side, file, to: level === 'model' && model ? 'model' : 'own' });
    } catch {
      setRejected((current) => ({ ...current, [side]: t('photoSlots.recropFailed') }));
    }
  };

  const sideLabel = (side: PhotoSide) => t(side === 'front' ? 'photoSlots.front' : 'photoSlots.back');
  const typeText = typeName ? t('photoSlots.levelIcon', { type: typeName }) : t('photoSlots.levelIconNoType');

  const screened = (side: PhotoSide, file: File | null): File | null => {
    setPicks((n) => n + 1);
    if (!file) return null;
    if (!isPhoto(file)) {
      setRejected((current) => ({ ...current, [side]: t('photoSlots.notImage', { name: file.name }) }));
      return null;
    }
    const result = screenAttachments([file], limits);
    const message = rejectionText(t, result, limits);
    setRejected((current) => ({ ...current, [side]: message }));
    return result.accepted[0] ?? null;
  };

  const levelText = (slot: PhotoSlot) => {
    switch (slot.level) {
      case 'own':
        return t('photoSlots.levelOwn');
      case 'model':
        return t('photoSlots.levelModel', { model: modelLabel ?? '' });
      case 'draft':
        return t('photoSlots.levelDraft');
      case 'unset':
        return t('photoSlots.levelUnset');
      default:
        return typeText;
    }
  };

  const picture = (side: PhotoSide, slot: PhotoSlot) =>
    slot.src ? (
      <img
        ref={(el) => {
          images.current[side] = el;
        }}
        className="photo-slot-img"
        src={slot.src}
        alt={t(slot.level === 'draft' ? 'photoSlots.draftAlt' : 'photoSlots.imageAlt', { side: sideLabel(side) })}
        onLoad={() => measure(side, true)}
      />
    ) : (
      <span className="photo-slot-placeholder">
        {typeIconSrc ? (
          <img className="photo-slot-type-icon" src={typeIconSrc} alt={typeText} />
        ) : (
          <span role="img" aria-label={typeText} className="photo-slot-type-glyph">
            <DeviceIcon />
          </span>
        )}
        {typeName ? <span className="photo-slot-type-name">{typeName}</span> : null}
      </span>
    );

  return (
    <div className="photo-slots">
      {PHOTO_SIDES.map((side) => {
        const slot = slots[side];
        const label = sideLabel(side);
        const replacing = slot.level === 'own' || slot.level === 'draft';
        const error = errors?.[side] ?? rejected[side] ?? null;
        const removable = slot.level === 'own' || slot.level === 'draft';
        // Ảnh model thắng ảnh riêng (Q-26 07/10): mặt đó không nhận ảnh riêng — server cũng từ chối.
        const fromModel = slot.level === 'model';
        return (
          <section key={side} className="photo-slot" role="group" aria-label={label} aria-busy={busySide === side || undefined}>
            {/* Khung cao theo ảnh (Q-23): ảnh 1U là một dải rộng, không phải vạch giữa ô cao. */}
            <header className="photo-slot-head">
              <strong>{label}</strong>
              <span className={`badge plain photo-slot-level ${slot.level}`}>{levelText(slot)}</span>
            </header>

            {readOnly || fromModel ? (
              <div className={`photo-slot-frame${slot.src ? ' has-img' : ''}`} data-testid="photo-slot-frame">{picture(side, slot)}</div>
            ) : (
              <FilePicker
                key={`${side}-${picks}`}
                className="photo-slot-drop"
                accept={PHOTO_ACCEPT}
                label={t(replacing ? 'photoSlots.replace' : 'photoSlots.upload')}
                inputLabel={t(replacing ? 'photoSlots.replaceOf' : 'photoSlots.uploadOf', { side: label })}
                hint={t('photoSlots.dropHint', { size: limits.maxSizeMb })}
                file={null}
                disabled={busy}
                flashKey={savedKey?.[side]}
                onPick={(file) => {
                  const accepted = screened(side, file);
                  if (accepted) setCropping({ side, file: accepted, to: 'own' });
                }}
              >
                <span className={`photo-slot-frame${slot.src ? ' has-img' : ''}`} data-testid="photo-slot-frame">
                  {picture(side, slot)}
                  {busySide === side ? (
                    <span className="photo-slot-busy" role="status">
                      <span className="spinner" aria-hidden="true" />
                      {t('photoSlots.uploading')}
                    </span>
                  ) : null}
                </span>
              </FilePicker>
            )}

            {fromModel && !readOnly ? <p className="muted small">{t('photoSlots.lockedByModel', { model: modelLabel ?? '' })}</p> : null}

            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}

            {slot.src && misfit[side] ? (
              <p className="photo-slot-misfit small">
                <span>{misfit[side] === 'aspect' ? t('photoSlots.misfitAspect', { units }) : t('photoSlots.misfitMargins')}</span>
                {!readOnly && loadOriginal && (!fromModel || model) ? (
                  <button type="button" className="btn sm" disabled={busy} aria-label={t('photoSlots.recropOf', { side: label })} onClick={() => void recrop(side, slot.level)}>
                    {t('photoSlots.recrop')}
                  </button>
                ) : null}
              </p>
            ) : null}

            {!readOnly && removable && onRemove ? (
              <button
                type="button"
                className="btn sm ghost photo-slot-remove"
                disabled={busy}
                aria-label={t(slot.level === 'draft' ? 'photoSlots.removeDraftOf' : 'photoSlots.removeOwnOf', { side: label })}
                onClick={() => onRemove(side)}
              >
                {t(slot.level === 'draft' ? 'photoSlots.removeDraft' : 'photoSlots.removeOwn')}
              </button>
            ) : null}

            {!readOnly && model && modelLabel ? (
              <div className="photo-slot-model">
                <p className="muted small">{t('photoSlots.modelExplain', { model: modelLabel })}</p>
                {slot.level === 'own' ? (
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy}
                    aria-label={t('photoSlots.modelCopyOf', { side: label })}
                    onClick={() => model.onCopyOwn(side)}
                  >
                    {t('photoSlots.modelCopy')}
                  </button>
                ) : (
                  <>
                    {/* Nút thật (không phải <label>): nút của app chỉ có kiểu trên phần tử <button>. */}
                    <button type="button" className="btn sm" disabled={busy} aria-hidden="true" tabIndex={-1} onClick={() => modelInputs.current[side]?.click()}>
                      {t('photoSlots.modelUpload')}
                    </button>
                    <input
                      key={`model-${side}-${picks}`}
                      ref={(el) => {
                        modelInputs.current[side] = el;
                      }}
                      type="file"
                      accept={PHOTO_ACCEPT}
                      className="file-picker-input"
                      disabled={busy}
                      aria-label={t('photoSlots.modelUploadOf', { side: label })}
                      onChange={(event) => {
                        const accepted = screened(side, event.target.files?.[0] ?? null);
                        if (accepted) setCropping({ side, file: accepted, to: 'model' });
                      }}
                    />
                  </>
                )}
              </div>
            ) : null}
          </section>
        );
      })}
      {cropping ? (
        <ImageCropDialog
          file={cropping.file}
          units={units}
          onCancel={() => setCropping(null)}
          onDone={(file) => {
            const { side, to } = cropping;
            setCropping(null);
            if (to === 'model') model?.onUpload(side, file);
            else onPick?.(side, file);
          }}
        />
      ) : null}
    </div>
  );
}
