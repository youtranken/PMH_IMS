import { useId, useState, type ReactNode } from 'react';
import { Chevron } from '@/ui/chevron';

/**
 * Khối gập của form dài (Q-27): tiêu đề là một nút mang tóm tắt và số ô đã khai, bấm để mở.
 *
 * Nội dung gập vẫn ở trong DOM (`hidden`), không tháo ra: `Dialog guardUnsaved` đo "đang gõ dở"
 * bằng các ô trong thân hộp, và giá trị đã gõ không được mất khi gập lại.
 *
 * `forceOpen` cho khối có lỗi bên trong: lỗi nằm trong khối gập thì người dùng bấm Lưu mà không
 * thấy ô nào đỏ — khối phải tự mở và không gập lại được tới khi hết lỗi.
 */
export function FoldSection({
  title,
  summary,
  count,
  defaultOpen = false,
  forceOpen = false,
  children,
}: {
  title: string;
  /** Kể ngắn trong khối có gì (chỉ hiện khi gập). */
  summary?: string;
  /** "2/5", "1 tệp", "trống"… */
  count?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = open || forceOpen;
  const bodyId = useId();
  return (
    <section className={shown ? 'fold-section is-open' : 'fold-section'}>
      <button
        type="button"
        className="fold-head"
        aria-expanded={shown}
        aria-controls={bodyId}
        onClick={() => setOpen(!shown)}
      >
        <Chevron direction={shown ? 'down' : 'right'} />
        <span className="fold-title">{title}</span>
        {/* Khoảng trắng giữa các mẩu: thiếu nó thì tên nút đọc dính "Ghi chútrống". */}
        {summary && !shown ? <> <span className="fold-summary">{summary}</span></> : null}
        {count ? <> <span className="fold-count">{count}</span></> : null}
      </button>
      <div id={bodyId} className="fold-body" hidden={!shown}>
        {children}
      </div>
    </section>
  );
}
