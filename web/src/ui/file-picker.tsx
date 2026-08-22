import { useId, useRef, useState } from 'react';

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
}: {
  /** Ví dụ: `.xlsx` — chỉ là gợi ý cho hộp thoại chọn file, KHÔNG phải kiểm tra bảo mật. */
  accept?: string;
  label: string;
  hint?: string;
  file: File | null;
  onPick: (file: File | null) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (list: FileList | null) => {
    onPick(list && list.length > 0 ? list[0] : null);
  };

  return (
    <div
      className={`file-picker${dragging ? ' dragging' : ''}${disabled ? ' disabled' : ''}`}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(false);
        pick(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled}
        className="file-picker-input"
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
            Bỏ chọn
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
