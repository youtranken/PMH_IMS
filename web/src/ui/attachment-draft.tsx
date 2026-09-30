import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import {
  limitsHint,
  rejectionText,
  screenAttachments,
  useAttachmentLimits,
} from '@/ui/attachment-limits';
import { FilePicker } from '@/ui/file-picker';
import { FormSection } from '@/ui/page-header';
import {
  ATTACHMENT_ACCEPT,
  formatSize,
  type AttachmentOwnerType,
} from '@/ui/attachment-panel';

/**
 * Giấy tờ chọn TRƯỚC khi hồ sơ tồn tại (AD-15).
 *
 * `AttachmentPanel` upload ngay, nên nó chỉ dùng được ở trang chi tiết — lúc đó đã có
 * `ownerId`. Nhưng hóa đơn/biên bản/ảnh máy nằm sẵn trên tay ĐÚNG lúc người ta gõ hồ sơ mới;
 * bắt lưu xong, mở lại hồ sơ, sang tab Giấy tờ rồi mới đính kèm là ba lần chuyển màn cho một
 * việc — và lần nào cũng có người quên hẳn.
 *
 * Cách làm: giữ `File` trong bộ nhớ trình duyệt, hồ sơ lưu xong (đã có id) mới đẩy lên. Ba
 * form thêm mới — thiết bị (2.2), phần mềm (3.1), đường truyền (3.3) — dùng CHUNG cái này,
 * không form nào tự dựng `<input type="file">` riêng.
 */
export interface AttachmentDraft {
  files: File[];
  add: (file: File | null) => void;
  /**
   * Thêm một lượt chọn, lọc cỡ/số file NGAY lúc chọn (Q-18): hồ sơ mới lưu xong mới đẩy file,
   * nên file quá cỡ phải bị bắt trước khi hồ sơ ghi xuống. `rejected` là lời báo cho phần bị bỏ.
   */
  addMany: (picked: File[]) => void;
  rejected: string | null;
  removeAt: (index: number) => void;
  /**
   * Đẩy hết file đang giữ lên cho một chủ thể ĐÃ CÓ id.
   *
   * KHÔNG ném lỗi: hồ sơ đã ghi xuống DB rồi, ném ra đây thì màn hình báo "lưu thất bại"
   * trong khi bản ghi vẫn nằm đó. Trả về danh sách câu lỗi để nơi gọi báo riêng.
   */
  upload: (
    ownerType: AttachmentOwnerType,
    ownerId: string,
    csrfToken: string,
  ) => Promise<string[]>;
}

export function useAttachmentDraft(): AttachmentDraft {
  const { t } = useTranslation();
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);
  const limits = useAttachmentLimits();
  /**
   * `upload` được gọi từ callback `onSuccess` của mutation lưu hồ sơ — một closure dựng ở
   * lượt render TRƯỚC lúc bấm Lưu. Đọc `files` thẳng ra là đọc bản chụp cũ; ref luôn là bản
   * mới nhất, nên file chọn ở giây cuối cũng không rơi mất.
   */
  const latest = useRef<File[]>(files);
  latest.current = files;

  const put = (next: File[]) => {
    latest.current = next;
    setFiles(next);
  };

  const addMany = (picked: File[]) => {
    // Chọn nhầm hai lần cùng một file thì server nhận hai bản trùng tên, không ai gỡ ra được.
    const fresh = picked.filter(
      (file, index) =>
        !latest.current.some((item) => item.name === file.name && item.size === file.size) &&
        picked.findIndex((other) => other.name === file.name && other.size === file.size) === index,
    );
    const screened = screenAttachments(fresh, limits, latest.current.length);
    setRejected(rejectionText(t, screened, limits));
    if (screened.accepted.length > 0) put([...latest.current, ...screened.accepted]);
  };

  return {
    files,
    rejected,
    add: (file) => {
      if (file) addMany([file]);
    },
    addMany,
    removeAt: (index) => {
      setRejected(null);
      put(latest.current.filter((_, i) => i !== index));
    },
    upload: async (ownerType, ownerId, csrfToken) => {
      const errors: string[] = [];
      for (const file of latest.current) {
        try {
          await uploadFile('/api/v1/files', file, csrfToken, { ownerType, ownerId });
        } catch (error) {
          errors.push(
            t('attachments.draftFailed', {
              name: file.name,
              reason: errorMessage(error),
            }),
          );
        }
      }
      put([]);
      return errors;
    },
  };
}

/** Khối "Giấy tờ đính kèm" đặt cuối form thêm mới — cùng khung `FormSection` với các khối khác. */
export function AttachmentDraftSection({
  draft,
  disabled,
}: {
  draft: AttachmentDraft;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const limits = useAttachmentLimits();

  return (
    <FormSection title={t('attachments.title')} columns={1}>
      {/* `key` đổi theo số file đang giữ = remount ô chọn. Không remount thì `<input>` vẫn
          giữ nguyên giá trị cũ, và chọn LẠI đúng file vừa bỏ ra sẽ không bắn `onChange`. */}
      <FilePicker
        key={draft.files.length}
        accept={ATTACHMENT_ACCEPT}
        label={t('attachments.pick')}
        hint={t('attachments.draftHint')}
        file={null}
        disabled={disabled}
        onPick={draft.add}
        onPickFiles={draft.addMany}
      />
      <p className="muted small">{limitsHint(t, limits)}</p>
      {draft.rejected ? (
        <p className="field-error" role="alert">
          {draft.rejected}
        </p>
      ) : null}

      {draft.files.length > 0 ? (
        <ul className="draft-file-list">
          {draft.files.map((file, index) => (
            <li key={`${file.name}-${file.size}`}>
              <span className="mono">{file.name}</span>{' '}
              <span className="muted">({formatSize(file.size)})</span>{' '}
              <button
                type="button"
                className="btn sm"
                disabled={disabled}
                aria-label={t('attachments.draftRemoveOf', { name: file.name })}
                onClick={() => draft.removeAt(index)}
              >
                {t('attachments.draftRemove')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </FormSection>
  );
}
