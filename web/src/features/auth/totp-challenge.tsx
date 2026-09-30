import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation, useMe } from '@/lib/api';
import { AuthCard } from './auth-card';
import { SupportHelp } from './support-help';
import { OtpInput, useOtpSubmit } from '@/ui/otp-input';

/**
 * Bước 2 của đăng nhập: nhập mã 6 số từ ứng dụng Authenticator. Đủ 6 số là tự gửi — người mở
 * thư duyệt trên điện thoại dán mã xong là vào, không phải tìm nút.
 *
 * Nút Xác nhận KHÔNG bị làm xám khi chưa đủ số: lý do xám chỉ nằm được trong tooltip, mà điện
 * thoại không có hover. Bấm sớm thì ô nói thẳng còn thiếu mấy số.
 */
export function TotpChallenge() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  /* Tách khỏi `error`: "còn thiếu 2 số" tự tắt khi gõ tiếp, còn câu "sai mã, còn 2 lần" thì
     phải đứng tới lượt gửi sau — gõ số đầu tiên không được xoá mất lời cảnh báo. */
  const [missing, setMissing] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const verify = useApiMutation<{ token: string }, { mustChangePassword: boolean }>(
    '/api/v1/auth/login/totp',
    { csrfToken: me?.csrfToken ?? null },
  );

  const submit = useOtpSubmit(async (code) => {
    setError(null);
    try {
      await verify.mutateAsync({ token: code });
    } catch (err) {
      setToken('');
      setError(
        errorMessage(err, t('auth.totpInvalid'), (left) => t('auth.attemptsLeft', { count: left })),
      );
      // Mã vừa bị từ chối đã bị xoá; con trỏ về lại ô để bàn phím số không đóng.
      inputRef.current?.focus();
    }
  });

  return (
    <AuthCard
      title={t('auth.totpTitle')}
      subtitle={t('auth.totpSub')}
      signedInAs={me}
      footer={<SupportHelp />}
    >
      <form
        className="auth-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (token.length !== 6) {
            setMissing(6 - token.length);
            inputRef.current?.focus();
            return;
          }
          void submit(token);
        }}
      >
        <OtpInput
          value={token}
          onChange={(next) => {
            setToken(next);
            setMissing(null);
          }}
          onComplete={(code) => void submit(code)}
          label={t('auth.totpCode')}
          hint={t('auth.totpHint')}
          error={missing ? t('auth.totpMissing', { count: missing }) : error}
          inputRef={inputRef}
          readOnly={verify.isPending}
        />
        <button type="submit" className="btn primary" disabled={verify.isPending}>
          {verify.isPending ? t('auth.totpChecking') : t('auth.totpVerify')}
        </button>
      </form>
    </AuthCard>
  );
}
