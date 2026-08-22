import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

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

const ToastContext = createContext<((o: ToastOptions) => void) | null>(null);

/**
 * Thông báo ngắn dùng chung (AD-15). Nơi gọi chỉ cần:
 *   const toast = useToast();
 *   toast({ message: 'Đã lưu', tone: 'ok' });
 *
 * Không màn nào tự dựng div thông báo góc màn hình. aria-live để trình đọc màn hình đọc được.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((options: ToastOptions) => {
    const tone = options.tone ?? 'ok';
    const item: ToastItem = {
      id: nextId.current++,
      message: options.message,
      tone,
      durationMs: options.durationMs ?? (tone === 'error' ? 7000 : 4000),
    };
    setItems((prev) => [...prev, item]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    }, item.durationMs);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.tone}`}>
            <span>{item.message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Đóng thông báo"
              onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
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
