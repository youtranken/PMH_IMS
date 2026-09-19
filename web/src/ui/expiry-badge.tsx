import {
  expiryLabel,
  expiryLevel,
  type ExpiryLevel,
  type ExpiryThresholds,
} from '@/lib/expiry';
import { useExpiryThresholds } from './use-expiry-thresholds';

const TONE: Record<ExpiryLevel, string> = {
  expired: 'danger',
  critical: 'danger',
  warning: 'warn',
  ok: 'ok',
  none: 'muted',
};

/**
 * Nhãn trạng thái hạn — AD-15: mọi màn (thiết bị, phần mềm, ISP, expiry, dashboard)
 * dùng chung component này, nên "sắp hết hạn" ở đâu cũng cùng một luật và cùng một màu.
 */
export function ExpiryBadge({
  end,
  now,
  showDate = false,
  thresholds: nguongTruyenVao,
}: {
  end: string | Date | null | undefined;
  now?: Date;
  showDate?: boolean;
  /**
   * Ngưỡng ĐI KÈM lượt trả về, cho màn nào có nó (19/09/2026).
   *
   * Màn `/expiry` nhận `thresholds` ngay trong phản hồi và dùng nó để LỌC bảng + ghi nhãn ô số.
   * Nếu huy hiệu ở cột Trạng thái vẫn tự hỏi `useExpiryThresholds()` thì một màn có HAI nguồn
   * ngưỡng: hook có `staleTime` 10 phút và `retry: false`, nên sau khi admin đổi
   * `expiry.critical_days` thành 14, bảng lọc theo 14 còn huy hiệu còn tô theo 7 (hoặc lùi về
   * mặc định khi `/expiry/thresholds` hỏng một lượt). Cùng một dòng, cùng một màn, hai câu trả
   * lời — đúng cái bẫy mà bản vá 18/09 sinh ra để dẹp, chỉ là nó dời từ ô số sang cột huy hiệu.
   *
   * Không truyền thì giữ nguyên hành vi cũ: hỏi hook. Mọi màn khác không có ngưỡng đi kèm.
   */
  thresholds?: ExpiryThresholds;
}) {
  // Ngưỡng đọc TỪ SERVER (AD-11), không phải bản sao trong web — xem `use-expiry-thresholds`.
  const nguongHook = useExpiryThresholds();
  const thresholds = nguongTruyenVao ?? nguongHook;
  const level = expiryLevel(end, now, thresholds);
  const label = expiryLabel(end, now);
  return (
    <span className={`badge ${TONE[level]}`} title={showDate && end ? String(end) : undefined}>
      {label}
    </span>
  );
}
