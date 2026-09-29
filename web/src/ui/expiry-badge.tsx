import { useTranslation } from 'react-i18next';
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
 * Nhãn trạng thái hạn — AD-15: mọi màn (thiết bị, phần mềm, expiry, dashboard)
 * dùng chung component này, nên "sắp hết hạn" ở đâu cũng cùng một luật và cùng một màu.
 */
export function ExpiryBadge({
  end,
  now,
  showDate = false,
  notCounted = false,
  thresholds: thresholdsProp,
}: {
  end: string | Date | null | undefined;
  now?: Date;
  showDate?: boolean;
  /**
   * Hồ sơ đã ở trạng thái cuối đời, tức KHÔNG còn được tính hạn.
   *
   * Các nguồn hạn bên API đều loại trạng thái ấy ra khỏi phép tính (`device`/`software` là
   * `retired`), nên màn danh sách vẽ huy hiệu vô điều kiện sẽ cãi nhau với chúng — cùng một hồ
   * sơ, `/software` kêu "Quá hạn 23 ngày" còn `/expiry` báo "0 Đã quá hạn" và `/disposal` nói
   * "Hồ sơ trong kho KHÔNG còn được tính hạn".
   *
   * Tên theo Ý NGHĨA chứ không theo tên trạng thái của một module (`retired`): module sau gọi
   * trạng thái cuối đời bằng tên khác thì không phải tự hỏi prop này có dành cho mình không.
   *
   * KHÔNG trả về `null`: một ô trống trong bảng đọc ra thành "thiếu dữ liệu", và người dùng đi
   * tìm xem ai quên nhập ngày hết hạn.
   */
  notCounted?: boolean;
  /**
   * Ngưỡng ĐI KÈM lượt trả về, cho màn nào có nó.
   *
   * Màn `/expiry` nhận `thresholds` ngay trong phản hồi và dùng nó để LỌC bảng + ghi nhãn ô số.
   * Nếu huy hiệu ở cột Trạng thái vẫn tự hỏi `useExpiryThresholds()` thì một màn có HAI nguồn
   * ngưỡng: hook có `staleTime` 10 phút và `retry: false`, nên sau khi admin đổi
   * `expiry.critical_days` thành 14, bảng lọc theo 14 còn huy hiệu còn tô theo 7 (hoặc lùi về
   * mặc định khi `/expiry/thresholds` hỏng một lượt). Cùng một dòng, cùng một màn, hai câu trả
   * lời.
   *
   * Không truyền thì hỏi hook. Mọi màn khác không có ngưỡng đi kèm.
   */
  thresholds?: ExpiryThresholds;
}) {
  const { t } = useTranslation();
  // Ngưỡng đọc TỪ SERVER (AD-11), không phải bản sao trong web — xem `use-expiry-thresholds`.
  const nguongHook = useExpiryThresholds();

  /*
   * Chốt này đứng trước mọi phép tính hạn — nhưng SAU hai lượt gọi hook ở trên, vì luật hook
   * không cho `return` sớm chen vào giữa. Hồ sơ không được tính hạn thì không có câu nào về
   * hạn là đúng cả: "Quá hạn 23 ngày" sai, mà "Không có hạn" cũng sai — nó CÓ ngày hết hạn,
   * chỉ là ngày ấy thôi có nghĩa.
   *
   * `plain` để nó không tranh màu với huy hiệu TRẠNG THÁI nằm ngay cột bên cạnh — cùng lối
   * với nhánh "Vĩnh viễn" của `software-screen.tsx`.
   */
  if (notCounted) {
    return (
      <span className="badge muted plain" title={t('expiry.notCountedTitle')}>
        {t('expiry.notCounted')}
      </span>
    );
  }

  const thresholds = thresholdsProp ?? nguongHook;
  const level = expiryLevel(end, now, thresholds);
  const label = expiryLabel(end, now);
  /* "Chưa khai hạn" viền đứt, khác hẳn "Không tính hạn" xám đặc: hai nhãn xám nói hai chuyện
     khác nhau (thiếu dữ liệu ≠ hồ sơ đã thanh lý) thì không được trông như một. */
  if (level === 'none') {
    return (
      <span className="badge muted dashed" title={t('expiry.labelNoneTitle')}>
        {label}
      </span>
    );
  }
  return (
    <span className={`badge ${TONE[level]}`} title={showDate && end ? String(end) : undefined}>
      {label}
    </span>
  );
}
