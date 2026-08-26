import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { downloadFile } from '@/lib/download-file';
import { formatDateTime } from '@/lib/format';
import { uploadFile } from '@/lib/upload';
import { FilePicker } from '@/ui/file-picker';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';

export interface AttachmentRecord {
  id: string;
  originalName: string;
  mimeType: string;
  kind: 'image' | 'document';
  sizeBytes: number;
  createdAt: string;
}

/**
 * Panel giấy tờ đính kèm dùng chung (AD-15, FR-002).
 *
 * Gắn vào BẤT KỲ chủ thể nào qua cặp `ownerType`/`ownerId` — thiết bị (2.3), phiếu ISO
 * (Epic 8), sự cố (Epic 9). Ba màn đó mà mỗi màn tự viết một panel upload thì ba lần
 * phải nhớ "tải về chứ không mở inline", và sẽ có màn quên.
 */
export function AttachmentPanel({
  ownerType,
  ownerId,
  csrfToken,
  canEdit = true,
}: {
  ownerType: 'device' | 'isp';
  ownerId: string;
  csrfToken: string;
  canEdit?: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const queryKey = ['files', ownerType, ownerId];
  const files = useQuery({
    queryKey,
    queryFn: () =>
      apiFetch<AttachmentRecord[]>(
        `/api/v1/files?ownerType=${ownerType}&ownerId=${encodeURIComponent(ownerId)}`,
      ),
  });

  const remove = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/files/${input.id}`,
    { method: 'DELETE', csrfToken, refreshMe: false, body: () => undefined },
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await uploadFile('/api/v1/files', file, csrfToken, { ownerType, ownerId });
      toast({ message: t('attachments.uploaded') });
      setFile(null);
      await refresh();
    } catch (error) {
      toast({ message: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const rows = files.data ?? [];

  return (
    <div className="attachment-panel">
      {canEdit ? (
        <>
          <FilePicker
            accept=".jpg,.jpeg,.png,.webp,.pdf,.xlsx"
            label={t('attachments.pick')}
            hint={t('attachments.hint')}
            file={file}
            disabled={busy}
            onPick={setFile}
          />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn primary"
              disabled={!file || busy}
              onClick={() => void submit()}
            >
              {busy ? t('attachments.uploading') : t('attachments.upload')}
            </button>
          </div>
        </>
      ) : null}

      {files.isLoading ? (
        <Loading />
      ) : files.isError ? (
        <LoadError onRetry={() => void files.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('attachments.empty')} hint={t('attachments.noPreview')} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{t('attachments.name')}</th>
                <th>{t('attachments.size')}</th>
                <th>{t('attachments.uploadedAt')}</th>
                <th className="col-center">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td data-label={t('attachments.name')}>{row.originalName}</td>
                  <td data-label={t('attachments.size')}>{formatSize(row.sizeBytes)}</td>
                  <td data-label={t('attachments.uploadedAt')}>{formatDateTime(row.createdAt)}</td>
                  <td>
                    <div className="action-cell">
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          // Tải qua fetch→blob để giữ ĐÚNG TÊN gốc; server luôn trả
                          // attachment + octet-stream nên không có chuyện mở inline.
                          void downloadFile(
                            `/api/v1/files/${row.id}/download`,
                            row.originalName,
                          ).catch((error: unknown) =>
                            toast({ message: errorMessage(error), tone: 'error' }),
                          );
                        }}
                      >
                        {t('attachments.download')}
                      </button>
                      {canEdit ? (
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={() => {
                            void (async () => {
                              const ok = await askConfirm({
                                message: t('attachments.confirmRemove', {
                                  name: row.originalName,
                                }),
                                danger: true,
                                confirmLabel: t('attachments.remove'),
                              });
                              if (!ok) return;
                              remove.mutate(
                                { id: row.id },
                                {
                                  onSuccess: () => {
                                    toast({ message: t('attachments.removed') });
                                    void refresh();
                                  },
                                  onError: (error) =>
                                    toast({ message: errorMessage(error), tone: 'error' }),
                                },
                              );
                            })();
                          }}
                        >
                          {t('attachments.remove')}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
