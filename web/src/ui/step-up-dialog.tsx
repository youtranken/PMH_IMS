import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Chevron } from '@/ui/chevron';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { Dialog } from '@/ui/dialog';
import { OtpInput, useOtpSubmit, useOtpSuccess } from '@/ui/otp-input';

/**
 * Phạm vi step-up (AD-17) — khớp `StepUpScope` của api. Mỗi phạm vi một mốc, một ân hạn: mã
 * nhập để xem sơ đồ không mở két và ngược lại.
 */
export type StepUpScope = 'vault' | 'diagram';

interface StepUpProps {
  csrfToken: string;
  /**
   * BẮT BUỘC, không mặc định: server từ chối `/auth/step-up` thiếu phạm vi, và nơi gọi đoán
   * nhầm phạm vi thì mã nhập để xem sơ đồ thành mã mở két. Lấy từ lỗi `STEPUP_REQUIRED`
   * (`useStepUpRetry` làm sẵn) hoặc từ đúng cửa nơi gọi đang mở.
   */
  scope: StepUpScope;
  /** Đang xác nhận để làm GÌ ("Xem enable của SW-CORE-01") — thiếu thì dùng câu chung. */
  purpose?: string;
  /**
   * Khoảng ân hạn để NÓI TRƯỚC cho người gõ ("10 phút tới không phải gõ lại") — lấy từ
   * `me.config`, tức số server đưa lúc đăng nhập. Chỉ để hiển thị; luật thật vẫn ở server.
   */
  graceMinutes?: number;
  onDone: (graceMinutes: number) => void;
}

/**
 * Ô mã + lượt gọi `/auth/step-up` — MỘT bản cho cả hộp riêng (`StepUpDialog`) lẫn bước trong
 * hộp đang mở (`StepUpStep`), để hai nơi không thể lệch nhau về cách gửi mã và xử lỗi.
 */
function useStepUpForm(
  csrfToken: string,
  scope: StepUpScope,
  onDone: (graceMinutes: number) => void,
  onBusyChange?: (busy: boolean) => void,
) {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const otp = useOtpSuccess();

  const stepUp = useApiMutation<{ token: string; scope: StepUpScope }, { graceMinutes: number }>(
    '/api/v1/auth/step-up',
    { csrfToken },
  );

  const submit = useOtpSubmit(async (code) => {
    setError(null);
    try {
      const result = await stepUp.mutateAsync({ token: code, scope });
      // Đóng hộp / thử lại việc vừa bị chặn chỉ sau khi người dùng thấy dấu tích. Bị hủy giữa
      // chừng (hộp tháo) thì việc đó là việc người dùng đã bỏ — không chạy hộ.
      if (!(await otp.show())) return;
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

  /*
   * Đang kiểm mã hoặc đang chạy hiệu ứng thành công: hộp chứa bước này không được đóng. Đóng lúc
   * đó thì server đã mở ân hạn mà màn hình nói là đã hủy.
   */
  const busy = stepUp.isPending || otp.status === 'success';
  const busyCb = useRef(onBusyChange);
  busyCb.current = onBusyChange;
  useEffect(() => {
    busyCb.current?.(busy);
  }, [busy]);
  useEffect(() => () => busyCb.current?.(false), []);

  return { token, setToken, error, inputRef, submit, pending: stepUp.isPending, busy, otp };
}

function StepUpFields({
  formId,
  scope,
  purpose,
  graceMinutes,
  form,
  autoFocus,
}: {
  formId: string;
  scope: StepUpScope;
  purpose?: string;
  graceMinutes?: number;
  form: ReturnType<typeof useStepUpForm>;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <form
      id={formId}
      className="form-grid"
      data-columns={1}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.submit(form.token);
      }}
    >
      <p className="muted">
        {purpose ?? (scope === 'diagram' ? t('auth.stepUpSubDiagram') : t('auth.stepUpSub'))}
      </p>
      {/* Câu phạm vi chỉ ở hộp mã chung (xem két / xem sơ đồ — UX-E38). Hộp đã nói việc cụ thể qua
          `purpose` thì câu "mã này mở két, không mở sơ đồ" là nhiễu. */}
      {purpose ? null : <p className="muted">{t(`auth.stepUpScopeNote_${scope}`)}</p>}
      {/* Đủ 6 số là tự gửi (`onComplete`) — trên điện thoại bàn phím số che mất nút Xác nhận. */}
      <OtpInput
        value={form.token}
        onChange={form.setToken}
        onComplete={(code) => void form.submit(code)}
        label={t('auth.totpCode')}
        id={`${formId}-otp`}
        inputRef={form.inputRef}
        autoFocus={autoFocus}
        // Đang kiểm mã: khoá ô (số gõ thêm không đè lên mã đang gửi) và cho hàng ô nhấp nháy.
        readOnly={form.pending}
        status={form.otp.status}
        onSuccessShown={form.otp.onShown}
        onConfirmed={form.otp.onConfirmed}
        /* Lỗi NGAY DƯỚI ô (viền đỏ + aria-invalid) — ô bị xoá trắng mà lỗi nằm chỗ khác thì
           người gõ không biết vì sao. */
        error={form.error}
        hint={
          graceMinutes
            ? t(scope === 'diagram' ? 'auth.stepUpGraceDiagram' : 'vault.stepUpGrace', {
                minutes: graceMinutes,
              })
            : undefined
        }
      />
    </form>
  );
}

function ConfirmButton({ formId, form }: { formId: string; form: ReturnType<typeof useStepUpForm> }) {
  const { t } = useTranslation();
  // Server đã nhận mã nhưng vòng ô còn quay tới mốc trọn vòng: vẫn "đang xử lý", không bấm lại.
  const working = form.busy;
  return (
    <button
      type="submit"
      form={formId}
      className="btn primary"
      disabled={working || form.token.length !== 6}
    >
      {form.otp.confirmed ? t('auth.otpVerified') : working ? t('common.working') : t('common.confirm')}
    </button>
  );
}

/**
 * Gõ TOTP để mở MỘT phạm vi step-up (FR-022, AD-17) — dùng chung (AD-15).
 *
 * `graceMinutes` chỉ để nói trước, và phải là số SERVER đưa (lỗi `STEPUP_REQUIRED` hoặc
 * `me.config`) — API mới là nơi biết ân hạn của từng phạm vi đang đặt bao nhiêu (AD-11). Nơi
 * gọi tự đoán 10 phút thì đổi cấu hình xong màn hình nói một đằng, hệ thống làm một nẻo.
 *
 * Nơi gọi KHÔNG tự tính "còn trong grace hay chưa": cứ gọi việc mình cần, gặp
 * `STEPUP_REQUIRED` thì mở hộp này rồi thử lại. Đồng hồ máy người dùng lệch cũng không sai —
 * máy chủ là nơi phán.
 */
export function StepUpDialog({
  csrfToken,
  scope,
  purpose,
  graceMinutes,
  onClose,
  onDone,
}: StepUpProps & { onClose: () => void }) {
  const { t } = useTranslation();
  const form = useStepUpForm(csrfToken, scope, onDone);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!form.busy}
      maxWidth={420}
      title={t('auth.stepUpTitle')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={form.busy}>
            {t('common.cancel')}
          </button>
          <ConfirmButton formId="stepup-form" form={form} />
        </>
      }
    >
      <StepUpFields
        formId="stepup-form"
        scope={scope}
        purpose={purpose}
        graceMinutes={graceMinutes}
        form={form}
      />
    </Dialog>
  );
}

/**
 * Chỉ 6 ô mã (+ lỗi ngay dưới ô), không câu giải thích, không nút Xác nhận — đủ 6 số là tự gửi,
 * Enter cũng gửi. Cho hộp nhỏ "Nhập mã 6 số để xem" của két (Q-24): nơi gọi tự đặt tiêu đề, tên
 * thứ đang mở và nút Hủy. Cùng hook gửi mã + hiệu ứng vòng với `StepUpDialog`.
 *
 * Nút Hủy nằm ở nơi gọi nên nơi gọi phải nghe `onBusyChange` để khoá Hủy / Esc trong lúc kiểm mã
 * và chạy hiệu ứng.
 */
export function StepUpOtp({
  csrfToken,
  scope,
  onDone,
  formId,
  onBusyChange,
}: Pick<StepUpProps, 'csrfToken' | 'scope' | 'onDone'> & {
  formId: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const form = useStepUpForm(csrfToken, scope, onDone, onBusyChange);
  return (
    <form
      id={formId}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.submit(form.token);
      }}
    >
      <OtpInput
        value={form.token}
        onChange={form.setToken}
        onComplete={(code) => void form.submit(code)}
        label={t('auth.totpCode')}
        id={`${formId}-otp`}
        inputRef={form.inputRef}
        readOnly={form.pending}
        status={form.otp.status}
        onSuccessShown={form.otp.onShown}
        onConfirmed={form.otp.onConfirmed}
        error={form.error}
      />
    </form>
  );
}

/**
 * Cùng bước gõ mã, nhưng nằm TRONG hộp đang mở thay cho một hộp chồng lên.
 *
 * Dùng khi nơi gọi đã ở trong một hộp có nội dung riêng của nó (vd hộp Cài lại 2 lớp): chồng
 * thêm hộp mã là hai lớp trên điện thoại, người dùng không biết mình đang ở lớp nào. Bảo
 * mật không đổi: mã vẫn đi đúng `/auth/step-up`, và bước này không giữ gì sau khi rời đi.
 */
export function StepUpStep({
  csrfToken,
  scope,
  purpose,
  graceMinutes,
  onBack,
  onDone,
  backLabel,
  onBusyChange,
}: StepUpProps & {
  onBack: () => void;
  backLabel: ReactNode;
  /** Hộp chứa bước này nghe để khoá Esc / nền / ✕ trong lúc kiểm mã và chạy hiệu ứng. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const form = useStepUpForm(csrfToken, scope, onDone, onBusyChange);
  return (
    <section className="form-grid" data-columns={1} aria-label={t('auth.stepUpTitle')}>
      <h3>{t('auth.stepUpTitle')}</h3>
      <StepUpFields
        formId="stepup-step-form"
        scope={scope}
        purpose={purpose}
        graceMinutes={graceMinutes}
        form={form}
        autoFocus
      />
      <div className="row" style={{ gap: 'var(--space-4)', justifyContent: 'space-between' }}>
        <button type="button" className="btn with-icon" onClick={onBack} disabled={form.busy}>
          <Chevron direction="left" />
          {backLabel}
        </button>
        <ConfirmButton formId="stepup-step-form" form={form} />
      </div>
    </section>
  );
}

/**
 * Hộp NHỎ hỏi mã (K-04, cùng dáng hộp "Nhập mã 6 số để xem" của két — Q-24): tiêu đề, một dòng
 * nói đang mở gì, 6 ô mã, nút Hủy. Không đoạn giải thích: người vừa bấm mở sơ đồ đã biết mình
 * định làm gì. Phạm vi mã do nơi gọi truyền, như `StepUpDialog`.
 */
export function StepUpCompactDialog({
  csrfToken,
  scope,
  title,
  subject,
  onClose,
  onDone,
}: Pick<StepUpProps, 'csrfToken' | 'scope' | 'onDone'> & {
  title: string;
  subject: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Mã đang được kiểm / hiệu ứng thành công đang chạy: đóng lúc này là mở ân hạn rồi bỏ đó.
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={() => {
        if (!busy) onClose();
      }}
      maxWidth={380}
      className="sheet reveal-popup"
      title={title}
      dismissible={!busy}
      footer={
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </button>
      }
    >
      <div className="reveal-popup-otp">
        <p className="reveal-popup-subject">{subject}</p>
        <StepUpOtp csrfToken={csrfToken} scope={scope} formId={`stepup-compact-${scope}`} onDone={onDone} onBusyChange={setBusy} />
      </div>
    </Dialog>
  );
}
