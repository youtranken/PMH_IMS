import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type ToastTone = 'ok' | 'error' | 'warn';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  /** Mặc định 4 giây; lỗi để lâu hơn cho người đọc kịp. */
  durationMs?: number;
}

interface ToastItem extends Required<Omit<ToastOptions, 'durationMs'>> {
  id: number;
  durationMs: number;
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
  const { t } = useTranslation();
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
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={`toast toast-${item.tone}`}
            onMouseEnter={() => pause(item.id)}
            onMouseLeave={() => resume(item.id)}
          >
            <ToastIcon tone={item.tone} />
            <span>{item.message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label={t('toast.close')}
              onClick={() => remove(item.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (o: ToastOptions) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast phải nằm trong <ToastProvider> (bọc ở App).');
  return ctx;
}
