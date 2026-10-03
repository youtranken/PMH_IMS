import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { useConfirm } from '@/ui/confirm-provider';
import { Field } from '@/ui/page-header';
import { useToast } from '@/ui/toast';

/**
 * Biểu tượng SVG riêng của một loại thiết bị trên sơ đồ mạng — chỉ SA (server chặn vai khác
 * bằng 403). Tệp gửi lên là CHỮ, server lọc (`sanitizeIconSvg`) rồi mới cất; tệp có script hay
 * trỏ ra ngoài bị từ chối kèm lý do hiện ngay dưới ô.
 *
 * Xem trước bằng `<img src="data:…">` chứ không chèn SVG vào DOM: SVG làm ảnh không chạy script,
 * kể cả khi lớp lọc phía server có lỗ.
 */
export function DeviceTypeDiagramIcon({ typeId, typeName, csrfToken }: { typeId: string; typeName: string; csrfToken: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const ask = useConfirm();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = ['catalog', 'device-type-icon', typeId];
  const icon = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<{ svg: string | null }>(`/api/v1/catalog/device-types/${typeId}/diagram-icon`),
  });

  const upload = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
      setError(t('catalog.diagramIconNotSvg'));
      return;
    }
    setBusy(true);
    try {
      const svg = await file.text();
      await apiFetch(`/api/v1/catalog/device-types/${typeId}/diagram-icon`, {
        method: 'POST',
        csrfToken,
        body: JSON.stringify({ svg }),
      });
      toast({ tone: 'ok', message: t('catalog.diagramIconSaved', { name: typeName }) });
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await ask({
      title: t('catalog.diagramIconRemoveTitle', { name: typeName }),
      message: t('catalog.diagramIconRemoveMessage'),
      confirmLabel: t('catalog.diagramIconRemove'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/catalog/device-types/${typeId}/diagram-icon`, { method: 'DELETE', csrfToken });
      toast({ tone: 'ok', message: t('catalog.diagramIconRemoved', { name: typeName }) });
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const svg = icon.data?.svg ?? null;
  return (
    <Field label={t('catalog.diagramIcon')} htmlFor={inputId} hint={t('catalog.diagramIconHint')} error={error}>
      <div className="row">
        {svg ? (
          <img
            className="diagram-icon-preview"
            src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
            alt={t('catalog.diagramIconPreview', { name: typeName })}
          />
        ) : (
          <span className="muted">{t('catalog.diagramIconNone')}</span>
        )}
        <input
          id={inputId}
          type="file"
          accept=".svg,image/svg+xml"
          aria-label={t('catalog.diagramIconUploadLabel')}
          disabled={busy}
          onChange={(event) => {
            void upload(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        {svg ? (
          <button type="button" className="btn sm" disabled={busy} onClick={() => void remove()}>
            {t('catalog.diagramIconRemove')}
          </button>
        ) : null}
      </div>
    </Field>
  );
}
