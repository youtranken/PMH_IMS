import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation, useMe } from '@/lib/api';
import { noteSignOutNotice } from '@/lib/after-logout';
import { AuthCard } from './auth-card';
import { SignOutLink, useSignOutMidFlow } from './sign-out-link';
import { SupportHelp } from './support-help';
import { totpChallengeStartedAt } from './totp-challenge-clock';
import { OtpInput, otpMissingText, useOtpSubmit } from '@/ui/otp-input';

/**
 * Bước 2 của đăng nhập: nhập mã 6 số từ ứng dụng Authenticator. Đủ 6 số là tự gửi — người mở
 * thư duyệt trên điện thoại dán mã xong là vào, không phải tìm nút.
 *
 * Nút Xác nhận KHÔNG bị làm xám khi chưa đủ số: lý do xám chỉ nằm được trong tooltip, mà điện
 * thoại không có hover. Bấm sớm thì ô nói thẳng còn thiếu mấy số (hoặc chưa nhập gì).
 *
 * Phiên chờ mã có hạn (Q-20): tab này không có mốc bắt đầu (F5, tab mới) hoặc quá
 * `config.totpChallengeMinutes` thì đóng phiên và về đăng nhập. Server cũng tự chặn ở cùng
 * ngưỡng (`SessionGuard`); đồng hồ ở đây chỉ để người dùng không phải gõ mã rồi mới biết.
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
  const { signOut } = useSignOutMidFlow(me);
  const expiredRef = useRef(false);

  const verify = useApiMutation<{ token: string }, { mustChangePassword: boolean }>(
    '/api/v1/auth/login/totp',
    { csrfToken: me?.csrfToken ?? null },
  );

  const limitMinutes = me?.config?.totpChallengeMinutes;
  useEffect(() => {
    const expire = () => {
      // StrictMode gắn effect hai lần — chỉ đăng xuất một lần.
      if (expiredRef.current) return;
      expiredRef.current = true;
      // Ghi câu báo TRƯỚC khi gọi logout: phiên có thể đã chết ở server, 401 nạp lại cứng
      // `/login` trước khi `onSettled` kịp chạy.
      noteSignOutNotice('totpExpired');
      signOut('totpExpired');
    };
    const startedAt = totpChallengeStartedAt();
    if (startedAt === null) {
      expire();
      return undefined;
    }
    if (!limitMinutes) return undefined;
    const timer = window.setTimeout(expire, Math.max(0, startedAt + limitMinutes * 60_000 - Date.now()));
    return () => window.clearTimeout(timer);
    // `signOut` đổi danh tính mỗi lần render; đồng hồ chỉ cần dựng lại khi ngưỡng đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limitMinutes]);

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
          error={otpMissingText(t, missing) ?? error}
          inputRef={inputRef}
          readOnly={verify.isPending}
        />
        <button type="submit" className="btn primary" disabled={verify.isPending}>
          {verify.isPending ? t('auth.totpChecking') : t('auth.totpVerify')}
        </button>
        {me ? <SignOutLink account={me} variant="back" /> : null}
      </form>
    </AuthCard>
  );
}
