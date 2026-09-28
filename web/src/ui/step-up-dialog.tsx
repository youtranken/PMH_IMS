import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { Dialog } from '@/ui/dialog';
import { OtpInput, useOtpSubmit } from '@/ui/otp-input';

/**
 * Gõ TOTP để mở quyền xem bí mật (FR-022, story 4.2) — dùng chung (AD-15).
 *
 * Không nhận `graceMinutes` từ nơi gọi: API trả về nó sau khi step-up thành công, và API mới
 * là nơi biết `secret.stepup_grace_minutes` đang đặt bao nhiêu (AD-11). Nơi gọi tự đoán 10
 * phút thì đổi cấu hình xong màn hình nói một đằng, hệ thống làm một nẻo.
 *
 * Nơi gọi KHÔNG tự tính "còn trong grace hay chưa": cứ gọi việc mình cần, gặp
 * `STEPUP_REQUIRED` thì mở hộp này rồi thử lại. Đồng hồ máy người dùng lệch cũng không sai —
 * máy chủ là nơi phán.
 */
export function StepUpDialog({
  csrfToken,
  purpose,
  graceMinutes,
  onClose,
  onDone,
}: {
  csrfToken: string;
  /** Đang xác nhận để làm GÌ ("Xem enable của SW-CORE-01") — thiếu thì dùng câu chung. */
  purpose?: string;
  /**
   * Khoảng ân hạn để NÓI TRƯỚC cho người gõ ("10 phút tới không phải gõ lại") — lấy từ
   * `me.config`, tức số server đưa lúc đăng nhập. Chỉ để hiển thị; luật thật vẫn ở server.
   */
  graceMinutes?: number;
  onClose: () => void;
  onDone: (graceMinutes: number) => void;
}) {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const stepUp = useApiMutation<{ token: string }, { graceMinutes: number }>(
    '/api/v1/auth/step-up',
    { csrfToken },
  );

  const submit = useOtpSubmit(async (code) => {
    setError(null);
    try {
      const result = await stepUp.mutateAsync({ token: code });
      setToken('');
      onDone(result.graceMinutes);
    } catch (err) {
      // Mã sai thì XÓA ô nhập: mã TOTP chỉ sống 30 giây, giữ lại con số cũ chỉ dụ người ta
      // bấm Gửi lần nữa với đúng cái mã vừa bị từ chối.
      setToken('');
      setError(errorMessage(err, undefined, (left) => t('auth.attemptsLeft', { count: left })));
      // Trả tiêu điểm về ô mã: mã 30 giây, người gõ cần gõ lại ngay chứ không đi tìm ô.
      inputRef.current?.focus();
    }
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={420}
      title={t('auth.stepUpTitle')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="stepup-form"
            className="btn primary"
            disabled={stepUp.isPending || token.length !== 6}
          >
            {stepUp.isPending ? t('common.loading') : t('common.confirm')}
          </button>
        </>
      }
    >
      <form
        id="stepup-form"
        className="form-grid"
        data-columns={1}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(token);
        }}
      >
        <p className="muted">{purpose ?? t('auth.stepUpSub')}</p>
        {/* Đủ 6 số là tự gửi (`onComplete`) — trên điện thoại bàn phím số che mất nút Xác nhận. */}
        <OtpInput
          value={token}
          onChange={setToken}
          onComplete={(code) => void submit(code)}
          label={t('auth.totpCode')}
          id="stepup-otp"
          inputRef={inputRef}
          /* Lỗi NGAY DƯỚI ô (viền đỏ + aria-invalid) — ô bị xoá trắng mà lỗi nằm chỗ khác thì
             người gõ không biết vì sao. */
          error={error}
          hint={graceMinutes ? t('vault.stepUpGrace', { minutes: graceMinutes }) : undefined}
        />
      </form>
    </Dialog>
  );
}
