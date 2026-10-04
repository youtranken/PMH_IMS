import { CheckIcon } from '@/ui/glyph-icons';

/** Cả nhịp vòng xanh + dấu tích (Q-21): khớp tổng thời lượng các animation `.success-burst` trong shared-kit.css. */
export const SUCCESS_BURST_MS = 1100;

/**
 * Vòng xanh loang + dấu tích báo một quyết định đã thành (duyệt két, duyệt / phát hành bản vẽ).
 * Cùng hình với dấu tích "mã đúng" của ô mã 2 lớp (dùng lại keyframe `otp-ripple`,
 * `otp-check-pop`), để người dùng đọc nó như một ký hiệu, không phải hình trang trí mới.
 *
 * Chỉ để nhìn: `aria-hidden` và không bắt chuột. Câu báo thật cho trình đọc màn hình vẫn là toast.
 * Nơi gọi thường không dựng nó trực tiếp mà truyền `burst: true` cho `useToast()` — toast tự vẽ
 * và tự gỡ, đúng một lần cho mỗi quyết định.
 */
export function SuccessBurst() {
  return (
    <div className="success-burst" aria-hidden="true">
      <span className="success-burst-seal">
        <CheckIcon className="success-burst-mark" />
      </span>
    </div>
  );
}
