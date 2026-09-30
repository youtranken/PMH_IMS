import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorCode, errorMessage, useApiMutation, useMe } from '@/lib/api';
import { Field } from '@/ui/page-header';
import { PasswordInput } from '@/ui/password-input';
import { useToast } from '@/ui/toast';
import { useFormErrors } from '@/ui/use-form-errors';
import { useIsNarrow } from '@/ui/use-narrow';
import { AuthCard } from './auth-card';
import { OtpInput, useOtpSubmit } from '@/ui/otp-input';
import { TotpSetup, type TotpSetupData } from './totp-setup';

type EnrollStart = TotpSetupData;

/**
 * Cài xác thực 2 lớp lần đầu (NFR-01: enroll bắt buộc).
 * Secret chỉ hiện MỘT LẦN ở màn này; server đã cất bản mã hóa envelope (AD-4).
 *
 * ===== VÌ SAO Ô MẬT KHẨU KHÔNG PHẢI LÚC NÀO CŨNG HIỆN =====
 *
 * Cửa `POST /auth/totp/enroll` đòi mật khẩu hiện tại — cái cookie phiên không đủ để gắn
 * một authenticator mới. Nhưng luồng đăng nhập bắt buộc cài 2 lớp được server
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
  /* Lỗi của ô mã nằm DƯỚI ô mã: giữa đầu card và ô mã là cả QR lẫn khoá, trên điện thoại lúc bàn
     phím mở thì hộp lỗi đầu card nằm ngoài màn hình. Đầu card chỉ còn lỗi cấp màn (không tạo
     được QR, sai mật khẩu ở bước hỏi lại). */
  const [codeError, setCodeError] = useState<string | null>(null);
  const [missing, setMissing] = useState<number | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const narrow = useIsNarrow();

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
          setError(errorMessage(err, t('auth.qrFailed')));
        },
      },
    );
  }, [me?.csrfToken, enroll, needPassword, startMutate, t]);

  const reauthCheck = useFormErrors({ password: !password && t('formErrors.required') });

  const submitCode = useOtpSubmit(async (code) => {
    setCodeError(null);
    try {
      await confirm.mutateAsync({ token: code });
      // Toast sống ngoài router: vẫn hiện sau khi `me` nạp lại và router chuyển sang bước kế.
      toast({ message: t('auth.enrollDone'), tone: 'ok', durationMs: 8000 });
    } catch (err) {
      setToken('');
      setCodeError(errorMessage(err, t('auth.totpInvalid')));
      codeRef.current?.focus();
    }
  });

  if (needPassword && !enroll) {
    return (
      <AuthCard
        title={t('auth.enrollTitle')}
        subtitle={t('auth.enrollReauthSub')}
        error={error}
        signedInAs={me}
        setupFor={me}
      >
        <form
          className="auth-form"
          ref={reauthCheck.formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!reauthCheck.check()) return;
            start.mutate(
              { currentPassword: password },
              {
                onSuccess: setEnroll,
                onError: (err) => {
                  setPassword('');
                  // Ô vừa bị xoá có chủ đích — đừng để luật "bắt buộc" mắng thêm một câu đỏ.
                  reauthCheck.reset();
                  setError(
                    errorMessage(err, t('auth.currentPasswordWrong'), (left) =>
                      t('auth.attemptsLeft', { count: left }),
                    ),
                  );
                },
              },
            );
          }}
        >
          <Field
            label={t('auth.currentPassword')}
            htmlFor="enroll-current"
            error={reauthCheck.error('password')}
          >
            <PasswordInput
              autoComplete="current-password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <button type="submit" className="btn primary" disabled={start.isPending}>
            {t('auth.enrollReauthSubmit')}
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t('auth.enrollTitle')}
      subtitle={t('auth.enrollSub')}
      error={error}
      signedInAs={me}
      setupFor={me}
    >
      {enroll ? (
        <>
          {/* Ba bước đánh số: người chưa từng dùng ứng dụng xác thực không biết phải cài app
              trước. Mã lấy ở đâu thì gợi ý dưới ô mã nói — các bước không nhắc lại. */}
          <ol className="totp-steps">
            <li>{t('auth.enrollStep1')}</li>
            <li>{t(narrow ? 'auth.enrollStep2Phone' : 'auth.enrollStep2')}</li>
            <li>{t('auth.enrollStep3')}</li>
          </ol>
          <TotpSetup data={enroll} />
          <form
            className="auth-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (token.length !== 6) {
                setMissing(6 - token.length);
                codeRef.current?.focus();
                return;
              }
              void submitCode(token);
            }}
          >
            <OtpInput
              value={token}
              onChange={(next) => {
                setToken(next);
                setMissing(null);
              }}
              onComplete={(code) => void submitCode(code)}
              // Điện thoại: không tự bật bàn phím — nó che mất nút mở ứng dụng và khoá cần chép.
              autoFocus={!narrow}
              label={t('auth.enrollConfirm')}
              hint={t('auth.totpHint')}
              error={missing ? t('auth.totpMissing', { count: missing }) : codeError}
              inputRef={codeRef}
              readOnly={confirm.isPending}
            />
            <button type="submit" className="btn primary" disabled={confirm.isPending}>
              {confirm.isPending ? t('auth.totpChecking') : t('auth.totpVerify')}
            </button>
          </form>
        </>
      ) : (
        <p className="auth-sub">{t('common.loading')}</p>
      )}
    </AuthCard>
  );
}
