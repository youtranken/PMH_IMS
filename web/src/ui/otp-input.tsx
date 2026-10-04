import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,   type KeyboardEvent,
  type MutableRefObject,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';

const OTP_LENGTH = 6;

/**
 * Trạng thái quanh lượt gửi mã. `verifying`: 6 ô xoay lần lượt (chỉ báo đang kiểm). `success`:
 * 6 ô gộp thành 1 ô có dấu tích, rồi mới gọi `onSuccessShown`. `error`: về 6 ô, lắc + đỏ.
 */
export type OtpStatus = 'idle' | 'verifying' | 'success' | 'error';

/**
 * Hiệu ứng thành công không được giữ người dùng lâu hơn mức này dù `animationend` không tới
 * (tab bị ẩn, trình duyệt bỏ animation): gộp ô + vẽ dấu tích + giữ ~0,9 giây, dư một nhịp.
 */
export const OTP_SUCCESS_FALLBACK_MS = 1800;
/** Một vòng xoay của ô (khớp `otp-spin` trong shared-kit.css): thời gian xoay tối thiểu trước khi gộp. */
export const OTP_MIN_SPIN_MS = 1200;

/**
 * Không có hiệu ứng nào để chờ: người dùng bật "giảm chuyển động", hoặc môi trường không chạy
 * animation CSS (không có `AnimationEvent`) — chờ ở đó chỉ là đứng yên tới hẹn giờ dự phòng.
 */
function noMotion(): boolean {
  if (typeof window.AnimationEvent === 'undefined') return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Cửa chờ hiệu ứng thành công cho nơi gọi `OtpInput`: `await show()` sau khi server nhận mã,
 * rồi mới điều hướng / đóng hộp. Promise luôn xong — `onShown` (ô báo vẽ xong) hoặc hẹn giờ
 * dự phòng của chính hook, để một sự kiện bị lỡ không bao giờ chặn đăng nhập.
 */
export function useOtpSuccess() {
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'shown'>('idle');
  const finish = useRef<(() => void) | null>(null);
  const show = useCallback(
    () =>
      new Promise<void>((resolve) => {
        // Server thường trả lời trong vài trăm ms — gộp ngay thì không ai kịp thấy vòng xoay.
        // Giữ trạng thái xoay trọn một vòng rồi mới gộp; máy không có chuyển động thì bỏ qua.
        const spinMs = noMotion() ? 0 : OTP_MIN_SPIN_MS;
        const timer = window.setTimeout(() => done(), spinMs + OTP_SUCCESS_FALLBACK_MS + 300);
        const done = () => {
          window.clearTimeout(timer);
          finish.current = null;
          resolve();
        };
        finish.current = done;
        if (spinMs === 0) {
          setPhase('shown');
          return;
        }
        setPhase('spinning');
        window.setTimeout(() => setPhase('shown'), spinMs);
      }),
    [],
  );
  const onShown = useCallback(() => finish.current?.(), []);
  const status = phase === 'shown' ? ('success' as const) : phase === 'spinning' ? ('verifying' as const) : undefined;
  return { status, show, onShown };
}

/**
 * Đặt các số vừa gõ/dán vào mã, bắt đầu từ ô `box`. Đủ 6 số trở lên là cả mã (dán, tự điền) — thay
 * hết, bất kể dán vào ô nào. Ít hơn thì ghi đè từ ô đó, nhưng không bắt đầu sau ô trống đầu
 * tiên: mã là chuỗi liền. `focusAt` là ô con trỏ đi tới tiếp theo.
 */
export function placeOtpDigits(value: string, box: number, digits: string): { next: string; focusAt: number } {
  if (digits.length >= OTP_LENGTH) return { next: digits.slice(0, OTP_LENGTH), focusAt: OTP_LENGTH - 1 };
  const start = Math.min(box, value.length);
  const next = (value.slice(0, start) + digits + value.slice(start + digits.length)).slice(0, OTP_LENGTH);
  return { next, focusAt: Math.min(start + digits.length, OTP_LENGTH - 1) };
}

/** Lượt gõ này vừa làm ô ĐỦ 6 số (trước đó chưa đủ) — mốc duy nhất được tự gửi. */
export function otpJustCompleted(prev: string, next: string): boolean {
  return next.length === 6 && prev.length !== 6;
}

/**
 * Câu báo khi bấm gửi lúc ô chưa đủ 6 số (`missing` = số còn thiếu). Ô trống hẳn thì nhắc
 * nhập (Q-20): "Còn thiếu 6 số." đọc như thể đã gõ gì đó sai.
 */
export function otpMissingText(t: (key: string, opts?: Record<string, unknown>) => string, missing: number | null): string | null {
  if (!missing) return null;
  return missing >= 6 ? t('auth.totpEmpty') : t('auth.totpMissing', { count: missing });
}

/**
 * Gửi mã 6 số, MỘT lượt mỗi lần. Ô tự gửi khi đủ 6 số, trong khi người dùng vẫn có thể bấm nút
 * hoặc Enter cùng lúc — mã TOTP dùng được một lần (chống replay), nên lượt thứ hai của cùng mã
 * bị server coi là sai và trừ một lượt thử. Chốt bằng ref vì hai lượt rơi vào cùng một nhịp
 * render thì state `isPending` chưa kịp đổi.
 */
export function useOtpSubmit(send: (code: string) => Promise<unknown>) {
  const inFlight = useRef(false);
  return useCallback(
    async (code: string) => {
      if (code.length !== 6 || inFlight.current) return;
      inFlight.current = true;
      try {
        await send(code);
      } finally {
        inFlight.current = false;
      }
    },
    [send],
  );
}

/**
 * Ô nhập mã 6 số dùng chung (AD-15) — dùng ở: nhập TOTP lúc đăng nhập, xác nhận enroll,
 * và step-up xem bí mật (FR-022). Sáu ô riêng, mỗi ô một số (Q-21); `value` vẫn là MỘT chuỗi
 * số liền (không có lỗ hổng giữa các ô) để nơi gọi không phải biết có bao nhiêu ô.
 * `onComplete` gọi đúng lúc mã vừa đủ 6 số — nơi gọi gửi qua `useOtpSubmit` để không gửi đúp.
 */
export function OtpInput({
  value,
  onChange,
  label,
  autoFocus = true,
  id = 'otp',
  onComplete,
  error,
  hint,
  inputRef,
  readOnly,
  status,
  onSuccessShown,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  autoFocus?: boolean;
  id?: string;
  onComplete?: (code: string) => void;
  /**
   * Lỗi của CHÍNH ô này (sai mã, thiếu số) — hiện ngay dưới ô. Để lỗi ở đầu card thì trên điện
   * thoại, lúc bàn phím mở, nó nằm ngoài màn hình và người dùng chỉ thấy ô bị xoá trắng.
   */
  error?: string | null;
  hint?: string;
  /**
   * Trỏ vào ô sẽ nhận số kế tiếp (ô trống đầu tiên) — nơi gọi `focus()` sau một lượt sai hoặc
   * thiếu số để giữ bàn phím số trên điện thoại mở, đúng ô cần gõ.
   */
  inputRef?: Ref<HTMLInputElement>;
  /** Đang gửi mã: khoá ô để lượt gõ thêm không đè lên mã đang được kiểm. */
  readOnly?: boolean;
  /**
   * Thiếu thì tự suy: có `error` → error; `readOnly` + đủ 6 số → verifying. `success` lấy từ
   * `useOtpSuccess().status`; lỗi luôn thắng verifying (thôi xoay khi server từ chối).
   */
  status?: OtpStatus;
  /** Gọi MỘT lần khi hiệu ứng thành công xong (hoặc ngay, nếu máy bật "giảm chuyển động"). */
  onSuccessShown?: () => void;
}) {
  const { t } = useTranslation();
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const labelId = `${id}-label`;
  // Ô nhận số kế tiếp. Con trỏ không đứng sau nó: mã là chuỗi liền, ô trống ở giữa không có nghĩa.
  const active = Math.min(value.length, OTP_LENGTH - 1);

  const state: OtpStatus =
    status === 'success'
      ? 'success'
      : error || status === 'error'
        ? 'error'
        : status === 'verifying' || (readOnly && value.length === OTP_LENGTH)
          ? 'verifying'
          : 'idle';
  // Đang chạy hiệu ứng thành công thì ô cũng khoá: mã đã được nhận, gõ thêm không còn nghĩa.
  const locked = readOnly || state === 'success';

  const shownCb = useRef(onSuccessShown);
  shownCb.current = onSuccessShown;
  const shownOnce = useRef(false);
  const reportShown = useCallback(() => {
    if (shownOnce.current) return;
    shownOnce.current = true;
    shownCb.current?.();
  }, []);
  useEffect(() => {
    if (state !== 'success') {
      shownOnce.current = false;
      return undefined;
    }
    if (noMotion()) {
      reportShown();
      return undefined;
    }
    const timer = window.setTimeout(reportShown, OTP_SUCCESS_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [state, reportShown]);
  // Dấu tích vẽ xong (animation cuối của chuỗi, đã gồm nhịp giữ) mới cho nơi gọi đi tiếp.
  // Nghe sự kiện gốc chứ không qua `onAnimationEnd` của React: React đoán tên sự kiện theo tiền tố
  // của trình duyệt, đoán sai là lỡ mất và người dùng phải chờ tới hẹn giờ dự phòng.
  const groupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = groupRef.current;
    if (state !== 'success' || !el) return undefined;
    const onEnd = (e: Event) => {
      if ((e.target as Element).classList?.contains('otp-check-mark')) reportShown();
    };
    el.addEventListener('animationend', onEnd);
    return () => el.removeEventListener('animationend', onEnd);
  }, [state, reportShown]);

  const focusBox = (i: number) => boxes.current[Math.max(0, Math.min(i, active))]?.focus();

  const commit = (next: string, focusAt: number) => {
    if (next !== value) {
      onChange(next);
      if (onComplete && otpJustCompleted(value, next)) onComplete(next);
    }
    // Đi tới ô kế ngay, không chờ nơi gọi render lại: số kế tiếp có thể đã tới trong cùng nhịp.
    boxes.current[Math.max(0, Math.min(focusAt, OTP_LENGTH - 1))]?.focus();
  };

  // Mã bị rút ngắn từ bên ngoài (nơi gọi xoá trắng sau lượt sai) mà con trỏ còn ở ô phía sau
  // → kéo về ô trống đầu tiên, để số gõ tiếp vào đúng chỗ.
  useLayoutEffect(() => {
    const at = boxes.current.indexOf(document.activeElement as HTMLInputElement);
    if (at > active) boxes.current[active]?.focus();
  }, [active]);

  const onBoxChange = (i: number, raw: string) => {
    if (locked) return;
    let digits = raw.replace(/\D/g, '');
    const current = value[i] ?? '';
    if (!digits) {
      if (current) commit(value.slice(0, i) + value.slice(i + 1), i);
      return;
    }
    // Ô đang có số mà chữ trong ô chưa được chọn sẵn: chuỗi mới là số cũ + số vừa gõ — giữ số vừa gõ.
    if (current && digits.length === 2 && digits.includes(current)) {
      digits = digits[0] === current ? digits[1] : digits[0];
    }
    const { next, focusAt } = placeOtpDigits(value, i, digits);
    commit(next, focusAt);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'Backspace':
      case 'Delete':
        e.preventDefault();
        if (locked) return;
        if (value[i]) commit(value.slice(0, i) + value.slice(i + 1), i);
        else if (e.key === 'Backspace' && i > 0) commit(value.slice(0, i - 1) + value.slice(i), i - 1);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        focusBox(i - 1);
        return;
      case 'ArrowRight':
        e.preventDefault();
        focusBox(i + 1);
        return;
      case 'Home':
        e.preventDefault();
        focusBox(0);
        return;
      case 'End':
        e.preventDefault();
        focusBox(active);
        return;
      default:
    }
  };

  return (
    <div className="field">
      <span className="lbl-t" id={labelId}>
        {label}
      </span>
      {/* Bấm vào khe giữa các ô, hay vào ô trống phía sau → về ô trống đầu tiên. Chuột thôi: bàn
          phím đã có Tab/←/→ trên từng ô. */}
      {/* Lớp trạng thái chỉ để vẽ chuyển động (shared-kit.css): `is-error` bật lại mỗi lượt sai vì
          nơi gọi xoá lỗi lúc gửi rồi mới đặt lỗi mới — animation lắc chạy lại. */}
      <div
        className={
          state === 'idle'
            ? 'otp-boxes'
            : `otp-boxes ${{ verifying: 'is-busy', success: 'is-success', error: 'is-error' }[state]}`
        }
        role="group"
        aria-busy={state === 'verifying' ? true : undefined}
        ref={groupRef}
        aria-labelledby={labelId}
        aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
        aria-invalid={error ? true : undefined}
        onMouseDown={(e) => {
          const at = boxes.current.indexOf(e.target as HTMLInputElement);
          if (at >= 0 && at <= active) return;
          e.preventDefault();
          boxes.current[active]?.focus();
        }}
      >
        {Array.from({ length: OTP_LENGTH }, (_, i) => (
          <input
            key={i}
            id={i === 0 ? id : `${id}-${i + 1}`}
            ref={(el) => {
              boxes.current[i] = el;
              if (i === active) assignRef(inputRef, el);
            }}
            className={value[i] ? 'inp otp-box is-filled' : 'inp otp-box'}
            // Thứ tự ô: nhịp lệch của vòng xoay "đang kiểm" (trái → phải) và đích trượt khi gộp ô.
            style={{ '--otp-i': i } as CSSProperties}
            aria-label={t('auth.otpDigit', { n: i + 1, total: OTP_LENGTH })}
            aria-invalid={error ? true : undefined}
            readOnly={locked}
            // Bàn phím số trên điện thoại cho mọi ô. Gợi ý mã từ tin nhắn/keychain chỉ ở ô đầu: trình
            // duyệt đổ cả mã vào ô đó, `onBoxChange` chia ra 6 ô.
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            /* Không `maxLength`: tự điền / dán đổ cả mã (kể cả "123 456") vào MỘT ô — cắt còn 1 ký tự
               thì mất 5 số còn lại. */
            pattern="[0-9]*"
            autoFocus={autoFocus && i === 0}
            // Tab chỉ dừng ở các ô tới ô trống đầu tiên, không dừng ở ô trống phía sau.
            tabIndex={i <= active ? 0 : -1}
            value={value[i] ?? ''}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => onBoxChange(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={(e) => {
              e.preventDefault();
              if (locked) return;
              const digits = e.clipboardData.getData('text').replace(/\D/g, '');
              if (!digits) return;
              const { next, focusAt } = placeOtpDigits(value, i, digits);
              commit(next, focusAt);
            }}
          />
        ))}
        {state === 'success' ? (
          <div className="otp-check">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path className="otp-check-mark" d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
            </svg>
            <span className="sr-only" role="status">
              {t('auth.otpVerified')}
            </span>
          </div>
        ) : null}
      </div>
      {error ? (
        <span className="field-error" role="alert" id={errorId}>
          {error}
        </span>
      ) : null}
      {hint ? (
        <span className="field-hint muted" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function assignRef<T>(ref: Ref<T> | undefined, el: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(el);
  else (ref as MutableRefObject<T | null>).current = el;
}
