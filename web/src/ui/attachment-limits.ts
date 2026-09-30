import { useMe } from '@/lib/api';
import type { Me } from '@/lib/me';

/**
 * Trần giấy tờ đính kèm phía web (Q-18) — MỘT chỗ cho panel đính kèm và khối chọn trước lúc lưu.
 *
 * Luật thật nằm ở `system_config` (`file.max_size_mb`, `file.max_files_per_batch`) và tới đây qua
 * `/auth/me`. Web kiểm TRƯỚC khi gửi vì form thêm mới chỉ đẩy file sau khi hồ sơ đã lưu: không
 * kiểm từ lúc chọn thì file quá cỡ chỉ lộ ra khi hồ sơ đã ghi xuống rồi. Server vẫn chặn cỡ file;
 * trần số file mỗi lượt thì chỉ web giữ, vì mỗi request mang đúng một file.
 */
export interface AttachmentLimits {
  maxSizeMb: number;
  maxFiles: number;
}

/**
 * Dự phòng khi `me` chưa về. Phải khớp giá trị seed — `api/test/config-seed.spec.ts` chốt điều đó.
 * Không dùng 0: 0 nghĩa là chặn mọi file.
 */
export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = { maxSizeMb: 25, maxFiles: 6 };

const MB = 1024 * 1024;

export function attachmentLimitsOf(me: Me | null | undefined): AttachmentLimits {
  const size = me?.config?.fileMaxSizeMb;
  const count = me?.config?.fileMaxFilesPerBatch;
  return {
    maxSizeMb: typeof size === 'number' && size > 0 ? size : DEFAULT_ATTACHMENT_LIMITS.maxSizeMb,
    maxFiles: typeof count === 'number' && count > 0 ? count : DEFAULT_ATTACHMENT_LIMITS.maxFiles,
  };
}

export function useAttachmentLimits(): AttachmentLimits {
  const { data: me } = useMe();
  return attachmentLimitsOf(me);
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Câu gợi ý đặt cạnh ô chọn — số lấy từ cấu hình. */
export function limitsHint(t: Translate, limits: AttachmentLimits): string {
  return t('attachments.limits', { size: limits.maxSizeMb, count: limits.maxFiles });
}

/** Lời báo cho các file bị bỏ ra khỏi lượt chọn; `null` khi không bỏ file nào. */
export function rejectionText(
  t: Translate,
  screened: { tooLarge: File[]; overCount: File[] },
  limits: AttachmentLimits,
): string | null {
  const quote = (files: File[]) => files.map((file) => `"${file.name}"`).join(', ');
  const parts: string[] = [];
  if (screened.tooLarge.length > 0) {
    parts.push(
      t('attachments.rejectedTooLarge', { names: quote(screened.tooLarge), size: limits.maxSizeMb }),
    );
  }
  if (screened.overCount.length > 0) {
    parts.push(
      t('attachments.rejectedOverCount', { names: quote(screened.overCount), count: limits.maxFiles }),
    );
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Chia một lượt chọn thành: nhận / quá cỡ / quá số file. Giữ thứ tự chọn; file quá cỡ không
 * chiếm chỗ trong lượt. `held` = số file đã giữ sẵn (khối chọn trước lúc lưu cộng dồn).
 */
export function screenAttachments(
  picked: File[],
  limits: AttachmentLimits,
  held = 0,
): { accepted: File[]; tooLarge: File[]; overCount: File[] } {
  const maxBytes = limits.maxSizeMb * MB;
  const accepted: File[] = [];
  const tooLarge: File[] = [];
  const overCount: File[] = [];
  for (const file of picked) {
    if (file.size > maxBytes) tooLarge.push(file);
    else if (held + accepted.length >= limits.maxFiles) overCount.push(file);
    else accepted.push(file);
  }
  return { accepted, tooLarge, overCount };
}
