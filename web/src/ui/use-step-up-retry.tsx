import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { errorCode } from '@/lib/api';
import { StepUpDialog } from '@/ui/step-up-dialog';

const STEPUP_CANCELLED = 'STEPUP_CANCELLED';

/**
 * Người dùng đóng hộp hỏi mã = HỦY, không phải lỗi để báo. Lời hứa của `run` bị reject bằng
 * lỗi này để nút Lưu không kẹt; nơi gọi hỏi qua đây thay vì so chữ, để chữ chỉ sống một chỗ.
 */
export function isStepUpCancelled(error: unknown): boolean {
  return (error as Error | null)?.message === STEPUP_CANCELLED;
}

/**
 * "Chạy việc này; gặp `STEPUP_REQUIRED` thì hỏi mã 6 số rồi chạy lại đúng việc đó."
 *
 * ===== VÌ SAO CÓ HOOK NÀY =====
 *
 * Không chỉ đường ĐỌC bí mật mà cả các đường GHI của két — cất, sửa, xoay, thu hồi — đều đòi
 * step-up (cửa trước khóa kỹ thì cửa sau cũng phải khóa). Nên mọi chỗ gọi bên web phải biết
 * hỏi mã; nếu không thì người dùng nhận 403 mà không có đường đi tiếp.
 *
 * Chép cơ chế bắt-lỗi-rồi-thử-lại ra từng chỗ là đúng thứ AD-15 cấm — các bản sao sẽ trôi
 * khỏi nhau. Nên gom vào đây.
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
 *   await stepUp.run(() => apiFetch('/api/v1/vault/secrets/x/rotate', {...}), t('vault.stepUpRotate'));
 *   ...
 *   {stepUp.dialog}
 */
export function useStepUpRetry(csrfToken: string): {
  /**
   * Chạy việc, tự hỏi mã và chạy lại MỘT lần nếu server đòi step-up. `purpose` là câu trên hộp
   * hỏi mã ("Nhập mã 6 số để duyệt mở két cho …"). BẮT BUỘC: câu chung không nói được người
   * dùng đang xác nhận việc gì, và từng có lúc nó nói "để xem thông tin bí mật" trong khi việc
   * đang làm là duyệt / thu hồi / cất / cài lại 2 lớp (VLT-047, Q-20).
   */
  run: <T>(action: () => Promise<T>, purpose: string) => Promise<T>;
  /** Đặt vào cây JSX của màn — hộp hỏi mã chỉ hiện khi cần. */
  dialog: ReactNode;
} {
  type Pending = {
    action: () => Promise<unknown>;
    purpose: string;
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
   * đúng chế độ hỏng mà hook này có mặt để chặn.
   */
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((next: Pending | null) => {
    const previous = pendingRef.current;
    pendingRef.current = next;
    setPending(next);
    if (previous) previous.reject(new Error(STEPUP_CANCELLED));
  }, []);

  useEffect(() => () => settle(null), [settle]);

  const run = useCallback(
    async <T,>(action: () => Promise<T>, purpose: string): Promise<T> => {
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
            purpose,
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
      purpose={pending.purpose}
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
