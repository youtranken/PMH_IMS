import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@/ui/dialog';
import { RevealContent, type TotpReveal } from '@/ui/reveal-dialog';
import { StepUpOtp } from '@/ui/step-up-dialog';

/** Giá trị server trả khi mở ngăn — thứ bước "giá trị" cần để hiện. */
export interface RevealedSecret {
  username: string | null;
  value: string;
  totp?: TotpReveal;
  seconds: number;
  stepUpSecondsLeft: number;
}

/**
 * Hộp NHỎ duy nhất của nút Xem két (Q-24): bước mã rồi bước giá trị trong CÙNG một hộp.
 *
 *   `otp`     — tiêu đề "Nhập mã 6 số để xem", tên ngăn, 6 ô mã, nút Hủy. Không đoạn giải thích
 *               nào: người bấm Xem đã biết mình định làm gì, chỉ cần biết đang mở NGĂN NÀO.
 *   `opening` — mã đã nhận, đang giải mã: giữ nguyên 6 ô (dấu tích của hiệu ứng vòng) thay vì
 *               nháy sang khung trống.
 *   `value`   — tiêu đề là tên ngăn, giá trị hiện dần từ mờ sang nét, vòng tròn đếm ngược tự ẩn,
 *               nút chép, nút "Ẩn ngay".
 *
 * Hộp chỉ hiển thị; gọi `/reveal` và quyết định bước do nơi gọi (`VaultPanel`) — máy chủ mới
 * biết còn ân hạn hay không, nên nơi gọi cứ gọi và chỉ mở bước `otp` khi gặp `STEPUP_REQUIRED`.
 * Phạm vi mã luôn là `vault`.
 */
export function VaultRevealPopup({
  csrfToken,
  label,
  step,
  revealed,
  onClose,
  onVerified,
  onExpire,
}: {
  csrfToken: string;
  /** Tên ngăn đang mở. */
  label: string;
  step: 'otp' | 'opening' | 'value';
  revealed: RevealedSecret | null;
  onClose: () => void;
  /** Mã đúng và hiệu ứng thành công đã chạy xong — nơi gọi thử mở ngăn lại. */
  onVerified: () => void;
  onExpire?: () => void;
}) {
  const { t } = useTranslation();
  const showValue = step === 'value' && revealed !== null;
  // Mã đang được kiểm / hiệu ứng thành công đang chạy: đóng lúc này là mở ân hạn rồi bỏ đó.
  const [otpBusy, setOtpBusy] = useState(false);
  const locked = step === 'opening' || (step === 'otp' && otpBusy);
  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={380}
      className="sheet reveal-popup"
      title={showValue ? label : t('vault.revealOtpTitle')}
      // Đang giải mã thì đừng cho đóng giữa chừng: lượt mở đã ghi nhật ký, đóng ngang là mất
      // giá trị người dùng vừa gõ mã để xem.
      dismissible={!locked}
      footer={
        /* Nút thường, không `primary`: lối ra không được là thứ sáng nhất hộp. */
        <button type="button" className="btn" onClick={onClose} disabled={locked}>
          {showValue ? t('vault.hideNow') : t('common.cancel')}
        </button>
      }
    >
      {showValue ? (
        <RevealContent
          label={label}
          username={revealed.username}
          value={revealed.value}
          totp={revealed.totp}
          seconds={revealed.seconds}
          stepUpSecondsLeft={revealed.stepUpSecondsLeft}
          onClose={onClose}
          onExpire={onExpire}
        />
      ) : (
        <div className="reveal-popup-otp">
          <p className="reveal-popup-subject">{label}</p>
          <StepUpOtp
            csrfToken={csrfToken}
            scope="vault"
            formId="vault-reveal-otp"
            onDone={() => onVerified()}
            onBusyChange={setOtpBusy}
          />
        </div>
      )}
    </Dialog>
  );
}
