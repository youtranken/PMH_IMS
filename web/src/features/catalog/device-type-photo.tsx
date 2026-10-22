import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { uploadFile } from '@/lib/upload';
import { useConfirm } from '@/ui/confirm-provider';
import { deviceTypePhotoSrc } from '@/ui/device-type-icon';
import { Field } from '@/ui/page-header';
import { useToast } from '@/ui/toast';

/**
 * Ảnh riêng của một loại thiết bị (PW-A18) — thay biểu tượng ở khung ảnh của máy chưa có ảnh thật.
 * Tải lên kho tệp dùng chung (`files`, `ownerType = 'device_type'`: cùng trần cỡ, kiểm định dạng
 * theo nội dung, trần điểm ảnh) rồi gán cho loại; server chỉ nhận ảnh của CHÍNH loại này và đưa
 * ảnh cũ vào thùng rác. Chỉ SA / Quản trị (server chặn vai khác).
 *
 * Ghi NGAY khi chọn tệp, không chờ nút Lưu của form — cùng cách với biểu tượng sơ đồ đứng ngay
 * trên (`DeviceTypeDiagramIcon`); dòng gợi ý nói rõ điều đó để Hủy không bị hiểu là bỏ ảnh.
 */
export function DeviceTypePhoto({
  typeId,
  typeName,
  photoFileId,
  csrfToken,
}: {
  typeId: string;
  typeName: string;
  photoFileId: string | null;
  csrfToken: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const ask = useConfirm();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [current, setCurrent] = useState(photoFileId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const assign = async (fileId: string | null) => {
    await apiFetch(`/api/v1/catalog/device-types/${typeId}/photo`, {
      method: 'PUT',
      csrfToken,
      body: JSON.stringify({ fileId }),
    });
    setCurrent(fileId);
    void queryClient.invalidateQueries({ queryKey: ['catalog'] });
  };

  const upload = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    setBusy(true);
    try {
      const saved = await uploadFile<{ id: string }>('/api/v1/files', file, csrfToken, { ownerType: 'device_type', ownerId: typeId });
      try {
        await assign(saved.id);
      } catch (err) {
        // Gán hỏng thì tệp vừa tải không thuộc chỗ nào — loại không có màn Giấy tờ để tự dọn.
        await apiFetch(`/api/v1/files/${saved.id}`, { method: 'DELETE', csrfToken }).catch(() => undefined);
        throw err;
      }
      toast({ tone: 'ok', message: t('catalog.typePhotoSaved', { name: typeName }) });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await ask({
      title: t('catalog.typePhotoRemoveTitle', { name: typeName }),
      message: t('catalog.typePhotoRemoveMessage'),
      confirmLabel: t('catalog.typePhotoRemove'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await assign(null);
      toast({ tone: 'ok', message: t('catalog.typePhotoRemoved', { name: typeName }) });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label={t('catalog.typePhoto')} htmlFor={inputId} hint={t('catalog.typePhotoHint')} error={error}>
      <div className="row">
        {current ? (
          <img
            className="diagram-icon-preview"
            src={deviceTypePhotoSrc(typeId, current)}
            alt={t('catalog.typePhotoPreview', { name: typeName })}
          />
        ) : (
          <span className="muted">{t('catalog.typePhotoNone')}</span>
        )}
        <input
          id={inputId}
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          aria-label={t('catalog.typePhotoUploadLabel')}
          disabled={busy}
          onChange={(event) => {
            void upload(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        {current ? (
          <button type="button" className="btn sm" disabled={busy} onClick={() => void remove()}>
            {t('catalog.typePhotoRemove')}
          </button>
        ) : null}
      </div>
    </Field>
  );
}
