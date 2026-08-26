import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@/ui/dialog';

/**
 * Hiện giá trị đúng `seconds` giây rồi tự đóng (FR-022).
 *
 * Đồng hồ đếm ngược tính từ MỘT mốc thời gian chụp lúc mở, không phải trừ dần mỗi giây:
 * trình duyệt ở tab nền bị hãm `setInterval` xuống 1 lần/phút, trừ dần thì cái hộp chứa mật
 * khẩu nằm mở hàng phút trên màn hình đã khóa. Tính từ mốc thì tab quay lại là đóng ngay.
 *
 * Giá trị KHÔNG vào clipboard tự động và không có nút "sao chép": clipboard sống qua cả
 * phiên đăng nhập, dán nhầm vào ô chat là mất luôn. Ai cần thì tự bôi đen.
 */
export function RevealDialog({
  label,
  value,
  seconds,
  onClose,
}: {
  label: string;
  value: string;
  seconds: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const deadline = useRef(Date.now() + seconds * 1000);
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    const tick = () => {
      const remaining = Math.ceil((deadline.current - Date.now()) / 1000);
      if (remaining <= 0) {
        onClose();
        return;
      }
      setLeft(remaining);
    };
    const timer = setInterval(tick, 250);
    // Quay lại tab sau khi bị hãm nhịp: kiểm ngay, không chờ nhịp kế tiếp.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [onClose]);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={480}
      title={label}
      footer={
        <button type="button" className="btn primary" onClick={onClose}>
          {t('vault.hideNow')}
        </button>
      }
    >
      <div className="form-grid" data-columns={1}>
        <p className="secret-value mono" data-testid="secret-value">
          {value}
        </p>
        <p className="muted" role="status">
          {t('vault.autoHide', { seconds: left })}
        </p>
        <p className="muted">
          <small>{t('vault.revealLogged')}</small>
        </p>
      </div>
    </Dialog>
  );
}
