import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation, useMe } from '@/lib/api';
import { downloadFile } from '@/lib/download-file';
import { formatDateTime } from '@/lib/format';
import { uploadFile } from '@/lib/upload';
import {
  limitsHint,
  rejectionText,
  screenAttachments,
  useAttachmentLimits,
} from '@/ui/attachment-limits';
import { FilePicker } from '@/ui/file-picker';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { useConfirm } from '@/ui/confirm-provider';
import { RowActions } from '@/ui/row-actions';
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
 * và cho khối chọn trước lúc lưu. Chốt chặn thật là kiểm nội dung ở server (Q-18: docx/pptx
 * đọc cả loại gói, bản có macro bị chặn), đây chỉ là gợi ý.
 */
export const ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.docx,.xlsx,.pptx';

export interface AttachmentRecord {
  id: string;
  originalName: string;
  mimeType: string;
  kind: 'image' | 'document';
  sizeBytes: number;
  createdAt: string;
  /** Họ tên người tải — API tra qua `users.api`; vắng thì dòng phụ không hiện. */
  uploadedByName?: string | null;
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

function attachmentsKey(ownerType: AttachmentOwnerType, ownerId: string) {
  return ['files', ownerType, ownerId];
}

/**
 * Panel giấy tờ đính kèm dùng chung (AD-15, FR-002).
 *
 * Gắn vào BẤT KỲ chủ thể nào qua cặp `ownerType`/`ownerId` — thiết bị, phiếu ISO, sự cố.
 * Mỗi màn tự viết một panel upload thì mỗi lần
 * phải nhớ "tải về chứ không mở inline", và sẽ có màn quên.
 */
/**
 * Câu gợi ý "giấy tờ gì" theo LOẠI hồ sơ — "hóa đơn, phiếu bảo hành" là của thiết bị, đặt dưới
 * một hợp đồng nhà mạng thì người ta không biết nên đính gì. Loại không có câu riêng dùng câu chung.
 */
/** Một file trong lô đang tải — dòng có nút Hủy riêng (DEV-081). */
interface UploadQueueItem {
  key: string;
  name: string;
  state: 'waiting' | 'uploading' | 'done' | 'failed' | 'cancelled';
}

const HINT_BY_OWNER: Partial<Record<AttachmentOwnerType, string>> = {
  isp: 'attachments.hint_isp',
  service_account: 'attachments.hint_service_account',
  subnet: 'attachments.hint_subnet',
  nat_rule: 'attachments.hint_nat_rule',
};

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
   * XÓA đính kèm chỉ dành cho SA/Admin — nên nút Xóa cũng phải biến mất với Member,
   * không phải bày ra để bấm rồi nhận 403.
   *
   * Đọc `me` qua `useMe()` chứ không thêm prop: bảy chỗ gọi panel này đều đang dùng `canEdit`
   * với nghĩa "chưa thanh lý / không đang bận", thêm một prop nữa là bảy lần phải nhớ truyền,
   * và quên một chỗ thì lỗi quay lại y như cũ. Dùng hook (không phải `getQueryData`) để panel
   * vẽ lại khi `me` về sau — ảnh chụp cache lúc dựng không bao giờ tự cập nhật.
   *
   * UI đừng bày nút ra để bấm rồi 403.
   */
  const { data: me } = useMe();
  const canDelete = canEdit && (me?.role === 'sa' || me?.role === 'admin');
  /** Tiến độ lô đang tải: `done`/`total`. `null` = không tải gì. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const limits = useAttachmentLimits();
  const [rejected, setRejected] = useState<string | null>(null);
  const cancelledRef = useRef(new Set<string>());
  const controllersRef = useRef(new Map<string, AbortController>());
  const markQueue = (key: string, state: UploadQueueItem['state']) =>
    setQueue((items) => items.map((item) => (item.key === key ? { ...item, state } : item)));
  const busy = progress !== null;

  const queryKey = attachmentsKey(ownerType, ownerId);
  const files = useOwnerAttachments(ownerType, ownerId);

  const remove = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/files/${input.id}`,
    { method: 'DELETE', csrfToken, refreshMe: false, body: () => undefined },
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  /*
   * Chọn hoặc thả là TẢI NGAY, nhiều file một lượt. Bước "Chọn file → bấm Tải lên" riêng hay bị
   * quên: người dùng chọn xong rời tab, file chưa bao giờ lên. Từng file một, tuần tự — một file
   * hỏng không kéo cả lô, và câu báo nói đúng file nào.
   */
  const uploadAll = async (picked: File[]) => {
    setProgress({ done: 0, total: picked.length });
    const batch = picked.map((file, index) => ({ key: `${Date.now()}-${index}`, file }));
    setQueue(batch.map(({ key, file }) => ({ key, name: file.name, state: 'waiting' })));
    let ok = 0;
    for (const [index, { key, file }] of batch.entries()) {
      if (!cancelledRef.current.has(key)) {
        const controller = new AbortController();
        controllersRef.current.set(key, controller);
        markQueue(key, 'uploading');
        try {
          await uploadFile(
            '/api/v1/files',
            file,
            csrfToken,
            { ownerType, ownerId },
            'file',
            controller.signal,
          );
          ok += 1;
          markQueue(key, 'done');
        } catch (error) {
          // Người dùng tự hủy thì không phải lỗi — không báo đỏ.
          if (!cancelledRef.current.has(key)) {
            markQueue(key, 'failed');
            toast({
              message: t('attachments.draftFailedLive', { name: file.name, reason: errorMessage(error) }),
              tone: 'error',
            });
          }
        } finally {
          controllersRef.current.delete(key);
        }
      }
      setProgress({ done: index + 1, total: picked.length });
    }
    if (ok > 0) toast({ message: t('attachments.uploadedCount', { count: ok }) });
    setProgress(null);
    setQueue([]);
    cancelledRef.current.clear();
    // Làm mới cả khi có file bị hủy: hủy lúc server đã nhận đủ thì file vẫn lên — danh sách
    // phải nói đúng sự thật, người dùng xóa nó ở đó.
    await refresh();
  };

  /** Lọc cỡ/số file TRƯỚC khi gửi (Q-18); file bị bỏ ra có lời báo ngay dưới ô chọn. */
  const pickMany = (picked: File[]) => {
    const screened = screenAttachments(picked, limits);
    setRejected(rejectionText(t, screened, limits));
    if (screened.accepted.length > 0) void uploadAll(screened.accepted);
  };

  /** Hủy MỘT file của lô: file đang chờ thì bỏ qua, file đang tải thì ngắt yêu cầu (DEV-081). */
  const cancelOne = (key: string) => {
    cancelledRef.current.add(key);
    controllersRef.current.get(key)?.abort();
    markQueue(key, 'cancelled');
  };

  const rows = files.data ?? [];

  return (
    <div className="attachment-panel">
      {canEdit ? (
        <>
          <FilePicker
            accept={ATTACHMENT_ACCEPT}
            label={t('attachments.pick')}
            hint={t(HINT_BY_OWNER[ownerType] ?? 'attachments.hint')}
            file={null}
            disabled={busy}
            onPick={(one) => {
              if (one) pickMany([one]);
            }}
            onPickFiles={pickMany}
          />
          <p className="muted small">{limitsHint(t, limits)}</p>
          {rejected ? (
            <p className="field-error" role="alert">
              {rejected}
            </p>
          ) : null}
          {progress ? (
            <p className="muted" role="status">
              {t('attachments.uploadingOf', { done: progress.done, total: progress.total })}
            </p>
          ) : null}
          {queue.length > 0 ? (
            <ul className="upload-queue">
              {queue.map((item) => (
                <li key={item.key}>
                  <span className="upload-queue-name">{item.name}</span>
                  <span className="muted">{t(`attachments.queue_${item.state}`)}</span>
                  {item.state === 'waiting' || item.state === 'uploading' ? (
                    <button
                      type="button"
                      className="btn sm ghost"
                      aria-label={t('attachments.cancelUpload', { name: item.name })}
                      onClick={() => cancelOne(item.key)}
                    >
                      {t('common.cancel')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {/* Luật "chỉ tải về, không mở inline" nói ngay chỗ đính kèm — không phải câu rỗng. */}
          <p className="muted small">{t('attachments.noPreview')}</p>
        </>
      ) : null}

      {files.isLoading ? (
        <Loading />
      ) : files.isError ? (
        <LoadError error={files.error} onRetry={() => void files.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('attachments.empty')}
          hint={canEdit ? t('attachments.emptyHint') : undefined}
        />
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
                  <td data-label={t('attachments.uploadedAt')}>
                    {formatDateTime(row.createdAt)}
                    {row.uploadedByName ? (
                      <span className="cell-sub">
                        {t('attachments.uploadedBy', { name: row.uploadedByName })}
                      </span>
                    ) : null}
                  </td>
                  <td data-label={t('common.actions')}>
                    {/* "Tải về" là việc dùng nhiều nhất: nút ghost luôn hiện. "Xóa" (việc phá) nằm
                        trong menu ⋯ chữ đỏ — nút đỏ đặc sát "Tải về" là mời bấm nhầm. */}
                    <div className="action-cell">
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => {
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
                        <RowActions
                          label={t('common.actionsOf', { subject: row.originalName })}
                          subject={row.originalName}
                          items={[
                            {
                              key: 'remove',
                              label: t('attachments.remove'),
                              danger: true,
                              disabled: remove.isPending,
                              onSelect: () => {
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
                              },
                            },
                          ]}
                        />
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
