import { useLayoutEffect, useState } from 'react';

/**
 * Chữ tự do trong ô bảng (ghi chú, mô tả, địa chỉ) rút MỘT dòng + "…" (`.cell-note`).
 *
 * Chỉ khi chữ THẬT SỰ bị cắt nó mới thành nút mở/thu (`aria-expanded`): `title` chỉ đọc được
 * bằng rê chuột, nên bàn phím và màn cảm ứng không bao giờ thấy phần còn lại. Chữ ngắn vẫn là
 * `<span>` — bảng dài mà ô nào cũng là nút thì Tab phải đi qua hàng trăm điểm dừng vô ích.
 *
 * Đo lại khi ô đổi cỡ (`ResizeObserver`): ở ≤960px bảng gập thẻ dọc và CSS tự nhả chữ ra, lúc
 * đó ô không còn bị cắt nên cũng không còn là nút.
 */
export function CellNote({ text, className }: { text: string; className?: string }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    // Đang mở thì chữ đã nhả hết nên đo ra "không bị cắt": đo lúc đó thì thu lại xong nút
    // biến thành span, mất tiêu điểm ngay dưới tay người dùng.
    if (!el || open) return undefined;
    const check = () => setTruncated(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, text, open]);

  const classes = ['cell-note', className, open ? 'is-open' : null].filter(Boolean).join(' ');

  // Đang mở thì chữ không còn bị cắt — vẫn phải giữ nút để thu lại được.
  if (!truncated && !open) {
    return (
      <span ref={setEl} className={classes}>
        {text}
      </span>
    );
  }
  return (
    <button
      ref={setEl}
      type="button"
      className={classes}
      aria-expanded={open}
      title={open ? undefined : text}
      onClick={(event) => {
        // Ô nằm trong dòng bấm-được (mở hồ sơ): mở ghi chú không được kéo theo mở hồ sơ.
        event.stopPropagation();
        setOpen((current) => !current);
      }}
    >
      {text}
    </button>
  );
}
