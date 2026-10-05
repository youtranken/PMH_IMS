import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { UploadIcon } from '@/ui/glyph-icons';

/** Loé xác nhận sau khi thả tệp — khớp `fp-drop` trong shared-kit.css. */
export const DROP_FLASH_MS = 600;

/**
 * Ô chọn file dùng chung (AD-15): kéo-thả hoặc bấm chọn, hiện tên + dung lượng file đã chọn.
 * Dùng ở import danh mục (2.1), import thiết bị (2.6), đính kèm giấy tờ (2.3).
 *
 * Không tự upload — chỉ trả `File` cho nơi gọi. Nơi gọi quyết định gửi đi đâu, để cùng một ô
 * chọn phục vụ được cả "xem trước rồi mới ghi" lẫn "upload ngay".
 */
export function FilePicker({
  accept,
  label,
  hint,
  file,
  onPick,
  disabled,
  onPickFiles,
  children,
  className,
  inputLabel,
  flashKey,
}: {
  /**
   * Nội dung vẽ TRONG vùng thả thay cho biểu tượng khay (vd ảnh đang dùng của ô ảnh thiết bị):
   * cả khung hình là chỗ thả, không chỉ một dải nhỏ cạnh nút.
   */
  children?: ReactNode;
  className?: string;
  /** Tên của ô chọn với trình đọc màn hình khi chữ trên nút không đủ phân biệt (vd "— Mặt trước"). */
  inputLabel?: string;
  /**
   * Đổi giá trị (khác 0) = loé xanh xác nhận như lúc thả tệp — dùng sau khi nơi gọi tải lên xong,
   * để "đã nhận" và "đã lưu" cùng một tín hiệu và cùng luật tắt chuyển động.
   */
  flashKey?: number;
  /**
   * Nhận NHIỀU file một lượt (chọn hoặc thả). Có prop này thì ô cho chọn nhiều và gọi hàm này
   * thay cho `onPick` — nơi gọi tự xử lý cả lô (vd tải lên ngay từng file).
   */
  onPickFiles?: (files: File[]) => void;
  /** Ví dụ: `.xlsx` — chỉ là gợi ý cho hộp thoại chọn file, KHÔNG phải kiểm tra bảo mật. */
  accept?: string;
  label: string;
  hint?: string;
  file: File | null;
  onPick: (file: File | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  /*
   * Đếm lượt vào/ra thay cho một cờ: rê tệp qua chữ hay nút bên trong vùng bắn `dragleave` của
   * vùng ngoài dù tệp chưa rời vùng — với một cờ, vùng nhấp nháy tắt/bật theo từng chữ.
   */
  const depth = useRef(0);
  const [dropped, setDropped] = useState(0);
  useEffect(() => {
    if (flashKey) setDropped((n) => n + 1);
  }, [flashKey]);
  useEffect(() => {
    if (dropped === 0) return;
    const timer = window.setTimeout(() => setDropped(0), DROP_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [dropped]);

  const pick = (list: FileList | null) => {
    if (onPickFiles) {
      const files = list ? Array.from(list) : [];
      if (files.length > 0) onPickFiles(files);
      // Xóa giá trị input: chọn lại đúng file vừa tải phải bắn onChange lần nữa.
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    onPick(list && list.length > 0 ? list[0] : null);
  };

  return (
    <div
      className={`file-picker${dragging ? ' dragging' : ''}${dropped ? ' dropped' : ''}${disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`}
      onDragEnter={(e) => {
        if (disabled) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        // Loé xác nhận "đã nhận tệp" (Q-21); khoá theo lượt để thả liền hai lần vẫn loé lại.
        if (e.dataTransfer.files.length > 0) setDropped((n) => n + 1);
        pick(e.dataTransfer.files);
      }}
    >
      {children ?? <UploadIcon className="file-picker-icon" />}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        multiple={!!onPickFiles}
        disabled={disabled}
        className="file-picker-input"
        aria-label={inputLabel}
        onChange={(e) => pick(e.target.files)}
      />
      <label htmlFor={inputId} className="file-picker-label">
        {label}
      </label>
      {hint ? <span className="file-picker-hint muted">{hint}</span> : null}
      {file ? (
        <p className="file-picker-file">
          <span className="mono">{file.name}</span>{' '}
          <span className="muted">({formatSize(file.size)})</span>{' '}
          <button
            type="button"
            className="btn sm"
            disabled={disabled}
            onClick={() => {
              onPick(null);
              // Xóa cả giá trị của input: không xóa thì chọn LẠI ĐÚNG file vừa bỏ sẽ không
              // bắn onChange (giá trị không đổi) và người dùng tưởng nút hỏng.
              if (inputRef.current) inputRef.current.value = '';
            }}
          >
            {t('filePicker.clear')}
          </button>
        </p>
      ) : null}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
