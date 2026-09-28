import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

/** Còn nội dung bị khuất ở mép trái (`start`) / mép phải (`end`) hay không. */
export function scrollEdges(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
): { start: boolean; end: boolean } {
  const max = scrollWidth - clientWidth;
  // Sai số 1px: trình duyệt phóng to cho ra `scrollLeft` lẻ, cuộn tới cuối vẫn thiếu 0.4px.
  return { start: scrollLeft > 1, end: scrollLeft < max - 1 };
}

/**
 * Theo dõi khung cuộn ngang còn nội dung khuất ở mép nào — dùng chung cho `ScrollX`, thanh
 * tab (`Tabs`) và cột dính của `DataTable`. Nghe cả cuộn lẫn đổi kích thước: cột mọc thêm khi
 * dữ liệu về, hoặc cửa sổ co lại, thì kích thước đổi mà không có sự kiện cuộn nào.
 */
export function useScrollEdges(
  ref: RefObject<HTMLElement | null>,
): { start: boolean; end: boolean } {
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      const next = scrollEdges(el.scrollLeft, el.scrollWidth, el.clientWidth);
      setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [ref]);
  return edges;
}

/**
 * Khung cuộn ngang cho bảng RỘNG HƠN màn hình (AD-15) — nói ra là còn cột bị khuất.
 *
 * Thanh cuộn ngang của trình duyệt chỉ hiện khi rê chuột vào (Windows 11, macOS) và nằm tận
 * đáy một bảng cao 70vh, nên một lưới rộng 2253px trông y như đã hết cột ở mép phải màn hình.
 * Khung này thêm hai thứ: vệt mờ ở mép còn nội dung (`data-more-start`/`data-more-end`, kiểu
 * dáng ở `shared-kit.css`), và một dòng chữ đọc được bằng mắt LẪN bằng trình đọc màn hình
 * (`aria-describedby` của vùng cuộn). Vùng cuộn nhận tiêu điểm để người dùng bàn phím cuộn
 * bằng phím mũi tên.
 */
export function ScrollX({
  ariaLabel,
  className = 'table-wrap',
  testId,
  children,
}: {
  /** Tên của vùng cuộn — trình đọc màn hình đọc nó khi Tab tới. */
  ariaLabel: string;
  /** Lớp của khung cuộn thật (mặc định `table-wrap`). */
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(ref);

  const overflowing = edges.start || edges.end;
  return (
    <div
      className="scroll-x"
      data-more-start={edges.start ? 'true' : undefined}
      data-more-end={edges.end ? 'true' : undefined}
    >
      {overflowing ? (
        <p id={hintId} className="scroll-x-hint muted">
          {t('dataTable.scrollHint')}
        </p>
      ) : null}
      <div
        ref={ref}
        className={className}
        data-testid={testId}
        role="region"
        aria-label={ariaLabel}
        aria-describedby={overflowing ? hintId : undefined}
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
