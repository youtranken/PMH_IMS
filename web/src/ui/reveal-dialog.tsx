import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@/ui/dialog';
import { countdownTone } from '@/ui/countdown-tone';

/**
 * Hiện giá trị đúng `seconds` giây rồi tự đóng (FR-022).
 *
 * Đồng hồ đếm ngược tính từ MỘT mốc thời gian chụp lúc mở, không phải trừ dần mỗi giây:
 * trình duyệt ở tab nền bị hãm `setInterval` xuống 1 lần/phút, trừ dần thì cái hộp chứa mật
 * khẩu nằm mở hàng phút trên màn hình đã khóa. Tính từ mốc thì tab quay lại là đóng ngay.
 *
 * Giá trị KHÔNG vào clipboard tự động và không có nút "sao chép": clipboard sống qua cả
 * phiên đăng nhập, dán nhầm vào ô chat là mất luôn. Ai cần thì tự bôi đen.
 *
 * HAI đồng hồ, không phải một — chúng trả lời hai câu khác nhau:
 *   trái  `60s`  — giá trị này còn hiện bao lâu nữa
 *   phải `600s` — còn mở được két bao lâu nữa mà không phải gõ lại mã 6 số
 * Thiếu số phải thì người dùng mở secret thứ hai lúc 9:09 và bị hỏi mã giữa chừng mà không
 * hiểu vì sao, dù cái mốc đó vốn đoán trước được.
 */
export function RevealDialog({
  label,
  value,
  seconds,
  stepUpSecondsLeft,
  onClose,
}: {
  label: string;
  value: string;
  seconds: number;
  /** Grace step-up còn lại lúc MỞ, do server tính. Không có thì chỉ hiện một đồng hồ. */
  stepUpSecondsLeft?: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const openedAt = useRef(Date.now());
  const deadline = useRef(openedAt.current + seconds * 1000);
  const [left, setLeft] = useState(seconds);
  const graceTotal = stepUpSecondsLeft ?? 0;
  const [graceLeft, setGraceLeft] = useState(graceTotal);

  useEffect(() => {
    const tick = () => {
      const remaining = Math.ceil((deadline.current - Date.now()) / 1000);
      /*
       * Grace đếm từ CÙNG một mốc với đồng hồ trái, nên hai số luôn khớp nhau: mở secret thứ
       * hai ngay sau đó là `60s/590s`, đúng như đọc trên đồng hồ treo tường. Trừ dần mỗi nhịp
       * thì tab nền bị hãm sẽ làm hai số trôi lệch nhau.
       */
      setGraceLeft(Math.max(0, graceTotal - Math.floor((Date.now() - openedAt.current) / 1000)));
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
  }, [onClose, graceTotal]);

  const tone = countdownTone(left, seconds);
  const graceTone = countdownTone(graceLeft, graceTotal);

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
        {/* `role="status"` để trình đọc màn hình đọc được mốc còn lại; `aria-live` mặc định
            của status là polite nên nó không cắt ngang mỗi giây. */}
        <p className="countdown" role="status" data-testid="reveal-countdown">
          <span className={`countdown-num ${tone}`}>{left}s</span>
          {stepUpSecondsLeft === undefined ? null : (
            <>
              <span className="countdown-sep" aria-hidden="true">
                /
              </span>
              <span className={`countdown-num ${graceTone}`} data-testid="stepup-countdown">
                {graceLeft}s
              </span>
            </>
          )}
          <span className="countdown-note muted">
            {stepUpSecondsLeft === undefined
              ? t('vault.autoHideShort')
              : t('vault.countdownNote')}
          </span>
        </p>
        <p className="muted">
          <small>{t('vault.revealLogged')}</small>
        </p>
      </div>
    </Dialog>
  );
}
