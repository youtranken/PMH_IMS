import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type ToastTone = 'ok' | 'error' | 'warn';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  /** Mặc định 4 giây; lỗi để lâu hơn cho người đọc kịp. */
  durationMs?: number;
  /**
   * Một nút làm bước kế tiếp hiển nhiên ("Mở hồ sơ" sau khi thêm máy). Bấm xong toast tự đóng.
   * Chỉ là lối tắt: việc đó phải làm được bằng đường khác, vì toast tự biến mất.
   */
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends Required<Omit<ToastOptions, 'durationMs' | 'action'>> {
  id: number;
  durationMs: number;
  action?: ToastOptions['action'];
}

/** Đồng hồ tự đóng của một toast — dừng được khi rê chuột vào, đặt lại khi rê ra. */
interface ToastTimer {
  timeoutId: number;
  /** Thời gian còn lại (ms) tính từ lúc tạm dừng — dùng để đặt lại đồng hồ khi rê chuột ra. */
  remainingMs: number;
  /** Mốc bắt đầu đếm của lần chạy hiện tại — dùng để tính remainingMs khi tạm dừng. */
  startedAt: number;
}

const ToastContext = createContext<((o: ToastOptions) => void) | null>(null);

/** Icon nhỏ dẫn đầu theo tone — dấu hiệu THỨ HAI ngoài màu, cho người khó phân biệt màu sắc. */
function ToastIcon({ tone }: { tone: ToastTone }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    className: 'toast-icon',
  };
  if (tone === 'ok') {
    return (
      <svg {...common}>
        <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
      </svg>
    );
  }
  if (tone === 'warn') {
    return (
      <svg {...common}>
        <path d="M12 5.5v7.5" />
        <path d="M12 17v.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/**
 * Thông báo ngắn dùng chung (AD-15). Nơi gọi chỉ cần:
 *   const toast = useToast();
 *   toast({ message: 'Đã lưu', tone: 'ok' });
 *
 * Không màn nào tự dựng div thông báo góc màn hình. aria-live để trình đọc màn hình đọc được.
 * Rê chuột vào một toast tạm dừng đồng hồ tự đóng (thông báo lỗi dài đọc chưa xong thì chưa mất);
 * rê ra thì đồng hồ chạy tiếp đúng phần thời gian còn lại.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ToastTimer>());

  const remove = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer.timeoutId);
      timers.current.delete(id);
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const push = useCallback((options: ToastOptions) => {
    const tone = options.tone ?? 'ok';
    const item: ToastItem = {
      id: nextId.current++,
      message: options.message,
      tone,
      durationMs: options.durationMs ?? (tone === 'error' ? 7000 : 4000),
      action: options.action,
    };
    setItems((prev) => [...prev, item]);
    timers.current.set(item.id, {
      timeoutId: window.setTimeout(() => remove(item.id), item.durationMs),
      remainingMs: item.durationMs,
      startedAt: Date.now(),
    });
  }, [remove]);

  const pause = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (!timer) return;
    window.clearTimeout(timer.timeoutId);
    timer.remainingMs = Math.max(0, timer.remainingMs - (Date.now() - timer.startedAt));
  }, []);

  const resume = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (!timer) return;
    timer.startedAt = Date.now();
    timer.timeoutId = window.setTimeout(() => remove(id), timer.remainingMs);
  }, [remove]);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        CÂU LỖI PHẢI ĐƯỢC ĐỌC NGAY — và vai `alert` nằm trên TỪNG DÒNG, không phải
        trên vùng chứa.

        Vấn đề: cả chồng toast nằm trong một `aria-live="polite"`, nghĩa là "chờ người dùng
        ngừng thao tác rồi hãy đọc". Đúng cho "Đã lưu hồ sơ", SAI cho một câu lỗi — người dùng
        vừa bấm Lưu và đang gõ tiếp, trình đọc màn hình lặng lẽ xếp hàng, và họ đi tiếp trong
        khi lượt ghi đã hỏng.

        BẢN ĐẦU dựng HAI vùng chứa, vùng lỗi mang `role="alert"`. Sai, và bộ E2E chỉ ra ngay:
        vùng ấy luôn nằm trong DOM kể cả khi rỗng, nên MỌI trang của sản phẩm bỗng có thêm một
        `alert` thứ hai — sáu bài đang hỏi "câu lỗi trên màn đăng nhập nói gì" đỏ vì
        `getByRole('alert')` trúng hai phần tử. Đó không chỉ là phiền cho bài kiểm: một vùng
        `alert` rỗng vĩnh viễn là thứ trình đọc màn hình phải bước qua trên mọi trang.

        Bản này đặt `role="alert"` lên chính DÒNG toast lỗi. Một phần tử mang vai `alert` vừa
        được chèn vào trang thì được đọc ngay — đúng thứ ta cần — và khi không có lỗi thì
        không có `alert` nào tồn tại cả. Vùng chứa giữ nguyên `role="status"`, nên mọi chỗ
        đang bám `getByRole('status')` vẫn đúng.
      */}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((item) => (
          <ToastRow key={item.id} item={item} onPause={pause} onResume={resume} onClose={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Một dòng toast. Tách ra để hai vùng `aria-live` dùng chung đúng MỘT bản đánh dấu —
 *  hai bản chép tay sẽ trôi lệch, và cái trôi lệch là cái ít người nhìn: vùng báo lỗi. */
function ToastRow({
  item,
  onPause,
  onResume,
  onClose,
}: {
  item: ToastItem;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
  onClose: (id: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`toast toast-${item.tone}`}
      /* Chỉ dòng LỖI mang vai `alert`; "Đã lưu" mà cắt ngang thứ người dùng đang nghe thì
         họ sẽ tắt hẳn thông báo đi. */
      role={item.tone === 'error' ? 'alert' : undefined}
      onMouseEnter={() => onPause(item.id)}
      onMouseLeave={() => onResume(item.id)}
    >
      <ToastIcon tone={item.tone} />
      <span>{item.message}</span>
      {item.action ? (
        <button
          type="button"
          className="btn sm toast-action"
          onClick={() => {
            item.action?.onClick();
            onClose(item.id);
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <button
        type="button"
        className="toast-close"
        aria-label={t('toast.close')}
        onClick={() => onClose(item.id)}
      >
        ×
      </button>
    </div>
  );
}

export function useToast(): (o: ToastOptions) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider> (wrapped in App).');
  return ctx;
}
