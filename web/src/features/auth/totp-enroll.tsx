import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorCode, errorMessage, useApiMutation, useMe } from '@/lib/api';
import { AuthCard } from './auth-card';
import { OtpInput } from '@/ui/otp-input';

interface EnrollStart {
  secret: string;
  qrDataUrl: string;
}

/**
 * Cài xác thực 2 lớp lần đầu (NFR-01: enroll bắt buộc).
 * Secret chỉ hiện MỘT LẦN ở màn này; server đã cất bản mã hóa envelope (AD-4).
 *
 * ===== VÌ SAO Ô MẬT KHẨU KHÔNG PHẢI LÚC NÀO CŨNG HIỆN (A-02) =====
 *
 * Từ 20/09 cửa `POST /auth/totp/enroll` đòi mật khẩu hiện tại — cái cookie phiên không còn
 * đủ để gắn một authenticator mới. Nhưng luồng đăng nhập bắt buộc cài 2 lớp được server
 * miễn: mật khẩu vừa gõ xong vài giây trước ở màn ngay trước đó.
 *
 * Nên màn này KHÔNG tự đoán trường hợp nào cần hỏi. Nó cứ gọi, và chỉ dựng ô mật khẩu khi
 * server trả `REAUTH_REQUIRED`. Luật "ai được miễn" vì thế sống đúng MỘT chỗ, ở server —
 * nơi biết tuổi phiên và cờ `totp_pending`. Đoán lại luật ấy ở client là dựng bản sao thứ
 * hai, và bản sao sẽ lệch đúng vào hôm luật đổi.
 */
export function TotpEnroll() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [enroll, setEnroll] = useState<EnrollStart | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const start = useApiMutation<{ currentPassword?: string }, EnrollStart>(
    '/api/v1/auth/totp/enroll',
    { csrfToken: me?.csrfToken ?? null },
  );
  const confirm = useApiMutation<{ token: string }, { status: string }>(
    '/api/v1/auth/totp/enroll/confirm',
    { csrfToken: me?.csrfToken ?? null },
  );

  const startMutate = start.mutate;
  useEffect(() => {
    if (!me?.csrfToken || enroll || needPassword) return;
    startMutate(
      {},
      {
        onSuccess: setEnroll,
        onError: (err) => {
          if (errorCode(err) === 'REAUTH_REQUIRED') {
            // Không phải lỗi — là bước còn thiếu. Hiện ô mật khẩu, đừng hiện chữ đỏ.
            setNeedPassword(true);
            return;
          }
          setError(errorMessage(err, 'Không tạo được mã QR.'));
        },
      },
    );
  }, [me?.csrfToken, enroll, needPassword, startMutate]);

  if (needPassword && !enroll) {
    return (
      <AuthCard title={t('auth.enrollTitle')} subtitle={t('auth.enrollReauthSub')} error={error}>
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start.mutate(
              { currentPassword: password },
              {
                onSuccess: setEnroll,
                onError: (err) => {
                  setPassword('');
                  setError(
                    errorMessage(err, 'Mật khẩu hiện tại không đúng.', (left) =>
                      t('auth.attemptsLeft', { count: left }),
                    ),
                  );
                },
              },
            );
          }}
        >
          <div className="field">
            <label className="lbl-t" htmlFor="enroll-current">
              {t('auth.currentPassword')}
            </label>
            <input
              id="enroll-current"
              className="inp"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn primary"
            disabled={start.isPending || password.length === 0}
          >
            {t('auth.enrollReauthSubmit')}
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('auth.enrollTitle')} subtitle={t('auth.enrollSub')} error={error}>
      {enroll ? (
        <>
          <img
            className="totp-qr"
            src={enroll.qrDataUrl}
            alt={t('auth.enrollQrAlt')}
            width={200}
            height={200}
          />
          <p className="auth-sub">
            {t('auth.enrollManual')} <code className="mono" data-testid="totp-secret">{enroll.secret}</code>
          </p>
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              confirm.mutate(
                { token },
                {
                  onError: (err) => {
                    setToken('');
                    setError(errorMessage(err, 'Mã xác thực không đúng.'));
                  },
                },
              );
            }}
          >
            <OtpInput value={token} onChange={setToken} label={t('auth.enrollConfirm')} />
            <button
              type="submit"
              className="btn primary"
              disabled={confirm.isPending || token.length !== 6}
            >
              {t('auth.totpVerify')}
            </button>
          </form>
        </>
      ) : (
        <p className="auth-sub">{t('common.loading')}</p>
      )}
    </AuthCard>
  );
}
