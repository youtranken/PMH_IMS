import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { downloadFile } from '@/lib/download-file';
import { formatDateTime } from '@/lib/format';
import { ME_KEY } from '@/lib/api';
import type { Me } from '@/lib/me';
import { uploadFile } from '@/lib/upload';
import { FilePicker } from '@/ui/file-picker';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';

/**
 * Chủ thể được phép có giấy tờ đính kèm — SOI GƯƠNG `FILE_OWNER_TYPES` phía API
 * (`api/src/modules/files/files.service.ts`). Thêm loại mới phải sửa cả hai đầu, không thì
 * client gửi lên một `ownerType` mà server từ chối.
 */
/* Phải khớp `FILE_OWNER_TYPES` bên API — thiếu một bên là 400 lúc tải lên. */
export type AttachmentOwnerType =
  | 'device'
  | 'isp'
  | 'software'
  | 'service_account'
  | 'subnet'
  | 'nat_rule';

/**
 * Đuôi file gợi ý cho hộp thoại chọn — MỘT chỗ duy nhất, dùng chung cho panel (đính kèm sau)
 * và cho khối chọn trước lúc lưu. Chốt chặn thật là magic-byte ở server, đây chỉ là gợi ý.
 */
export const ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.xlsx';

export interface AttachmentRecord {
  id: string;
  originalName: string;
  mimeType: string;
  kind: 'image' | 'document';
  sizeBytes: number;
  createdAt: string;
}

/**
 * Giấy tờ của một chủ thể — MỘT định nghĩa truy vấn, hai nơi dùng.
 *
 * Panel dưới đây cần cả danh sách; nhãn tab của trang chi tiết chỉ cần cái `length`. Hai chỗ
 * mà tự khai truy vấn riêng thì khóa cache lệch nhau một phần tử là đủ để cùng một câu hỏi đi
 * hai lượt mạng và cho hai con số khác nhau — con số trên tab nói 3, mở ra thấy 4.
 *
 * Gọi ở trang chi tiết còn được thêm một thứ: lúc người ta bấm sang tab Giấy tờ thì dữ liệu đã
 * nằm sẵn trong cache, panel không phải quay vòng chờ nữa.
 */
export function useOwnerAttachments(ownerType: AttachmentOwnerType, ownerId: string) {
  return useQuery({
    queryKey: attachmentsKey(ownerType, ownerId),
    queryFn: () =>
      apiFetch<AttachmentRecord[]>(
        `/api/v1/files?ownerType=${ownerType}&ownerId=${encodeURIComponent(ownerId)}`,
      ),
  });
}

export function attachmentsKey(ownerType: AttachmentOwnerType, ownerId: string) {
  return ['files', ownerType, ownerId];
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
  ownerType: AttachmentOwnerType;
  ownerId: string;
  csrfToken: string;
  canEdit?: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();

  /*
   * XÓA đính kèm siết về SA/Admin từ 08/09 (C1) — nên nút Xóa cũng phải biến mất với Member,
   * không phải bày ra để bấm rồi nhận 403.
   *
   * Đọc `me` thẳng từ cache dùng chung (`ME_KEY`) chứ không thêm prop: bảy chỗ gọi panel này
   * đều đang dùng `canEdit` với nghĩa "chưa thanh lý / không đang bận", thêm một prop nữa là
   * bảy lần phải nhớ truyền, và quên một chỗ thì lỗi quay lại y như cũ. `me` luôn có sẵn
   * trong cache vì shell nạp nó trước khi dựng bất kỳ màn nào.
   *
   * Đây đúng luật mà `device-detail.tsx:228` tự đặt ra: "UI đừng bày nút ra để bấm rồi 403".
   */
  const me = queryClient.getQueryData<Me>(ME_KEY);
  const canDelete = canEdit && (me?.role === 'sa' || me?.role === 'admin');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const queryKey = attachmentsKey(ownerType, ownerId);
  const files = useOwnerAttachments(ownerType, ownerId);

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
            accept={ATTACHMENT_ACCEPT}
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
        <LoadError error={files.error} onRetry={() => void files.refetch()} />
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
                  <td data-label={t('common.actions')}>
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
                      {canDelete ? (
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={() => {
                            void (async () => {
                              const ok = await askConfirm({
                                title: t('common.titleOf', {
                                  action: t('attachments.remove'),
                                  subject: row.originalName,
                                }),
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
