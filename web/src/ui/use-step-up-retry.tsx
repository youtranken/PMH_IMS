import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { errorCode } from '@/lib/api';
import { StepUpDialog } from '@/ui/step-up-dialog';

/**
 * "Chạy việc này; gặp `STEPUP_REQUIRED` thì hỏi mã 6 số rồi chạy lại đúng việc đó."
 *
 * ===== VÌ SAO CÓ HOOK NÀY =====
 *
 * Cơ chế bắt-lỗi-rồi-thử-lại từng chỉ tồn tại ở MỘT chỗ: `vault-panel.tsx`, cho đường ĐỌC bí
 * mật. Rà soát 07/09 (C2) chỉ ra các đường GHI của két — cất, sửa, xoay, thu hồi — không đòi
 * step-up, tức cửa trước khóa kỹ còn cửa sau để mở. Khi API được siết lại cho khớp, bốn chỗ
 * gọi bên web phải biết hỏi mã; nếu không thì người dùng nhận 403 mà không có đường đi tiếp.
 *
 * Chép đoạn đó ra bốn bản là đúng thứ AD-15 cấm — và là đúng cách các bản sao trong repo này
 * đã trôi khỏi nhau (xem mẫu M5). Nên gom vào đây.
 *
 * ===== NGUYÊN TẮC: KHÔNG TỰ ĐOÁN "CÒN TRONG GRACE HAY CHƯA" =====
 *
 * Client không đọc được `stepped_up_at`, và đồng hồ máy người dùng có thể lệch; admin cũng có
 * thể vừa đổi `secret.stepup_grace_minutes`. Nên cứ gọi, để SERVER trả lời. Đó cũng là lý do
 * `vault-panel.tsx` được viết như vậy từ đầu — hook này giữ nguyên nếp đó.
 *
 * Dùng:
 *   const stepUp = useStepUpRetry(csrfToken);
 *   ...
 *   await stepUp.run(() => apiFetch('/api/v1/vault/secrets/x/rotate', {...}));
 *   ...
 *   {stepUp.dialog}
 */
export function useStepUpRetry(csrfToken: string): {
  /** Chạy việc, tự hỏi mã và chạy lại MỘT lần nếu server đòi step-up. */
  run: <T>(action: () => Promise<T>) => Promise<T>;
  /** Đặt vào cây JSX của màn — hộp hỏi mã chỉ hiện khi cần. */
  dialog: ReactNode;
} {
  type Pending = {
    action: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  };
  const [pending, setPending] = useState<Pending | null>(null);

  /*
   * Bản sao trong ref để hai chỗ dưới đây đọc được lời hứa ĐANG treo mà không phải phụ thuộc
   * vào `pending` trong closure:
   *   1. `run()` bị gọi lần nữa khi lần trước còn đang chờ gõ mã;
   *   2. component tháo trong lúc hộp hỏi mã còn mở.
   *
   * Không có nó thì lời hứa cũ KHÔNG BAO GIỜ settle: nơi gọi `await` mãi, `finally
   * { setBusy(false) }` không chạy, nút Lưu kẹt ở "Đang xử lý…" tới khi tải lại trang —
   * đúng chế độ hỏng mà hook này sinh ra để chặn (rà soát 08/09, #6).
   */
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((next: Pending | null) => {
    const previous = pendingRef.current;
    pendingRef.current = next;
    setPending(next);
    if (previous) previous.reject(new Error('STEPUP_CANCELLED'));
  }, []);

  useEffect(() => () => settle(null), [settle]);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (error) {
        if (errorCode(error) !== 'STEPUP_REQUIRED') throw error;
        /*
         * Treo lời hứa lại chờ người dùng gõ mã. Nơi gọi vẫn `await` một lần duy nhất, nên
         * chuỗi việc phía sau (toast, đóng form, làm mới danh sách) không phải biết gì về
         * step-up — chúng chạy sau khi thử lại thành công, y như khi không có hàng rào.
         */
        return new Promise<T>((resolve, reject) => {
          settle({
            action: action as () => Promise<unknown>,
            resolve: resolve as (value: unknown) => void,
            reject,
          });
        });
      }
    },
    [settle],
  );

  const dialog = pending ? (
    <StepUpDialog
      csrfToken={csrfToken}
      onClose={() => {
        // Đóng hộp = HỦY việc. `settle(null)` lo phần `reject` — xem chú thích ở trên.
        settle(null);
      }}
      onDone={() => {
        const current = pending;
        // Gỡ khỏi ref TRƯỚC khi xóa state, để `settle` không reject chính lời hứa sắp thành công.
        pendingRef.current = null;
        setPending(null);
        /*
         * Thử lại ĐÚNG MỘT lần. Gõ mã xong mà vẫn bị đòi mã nữa thì đó là lỗi thật, không
         * phải chuyện để hỏi vòng hai — nếu không sẽ thành vòng lặp hộp thoại không thoát được
         * (đúng cái bẫy mà `vault-panel.tsx` đã ghi lại bằng cờ `afterStepUp`).
         */
        current.action().then(current.resolve, current.reject);
      }}
    />
  ) : null;

  return { run, dialog };
}
