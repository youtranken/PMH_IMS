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
import { motionReduced } from '@/lib/motion';
import { CheckIcon } from '@/ui/glyph-icons';

const OTP_LENGTH = 6;

/**
 * Trạng thái quanh lượt gửi mã. `verifying`: 6 ô rời hàng lên một vòng tròn và cả vòng quay (chỉ
 * báo đang kiểm). `success`: vòng dừng ở mốc trọn vòng, ô hội tụ thành 1 ô, vòng xanh + dấu tích,
 * rồi mới gọi `onSuccessShown`. `error`: ô bay về hàng, lắc + đỏ.
 */
export type OtpStatus = 'idle' | 'verifying' | 'success' | 'error';

/*
 * Cả chuỗi mã đúng — vòng tối thiểu + hội tụ + dấu tích — gói trong 2 giây ở MỌI nơi (Q-33): mở
 * két gấp trên điện thoại thì hiệu ứng không được đứng chắn trước mật khẩu.
 */
/** Ô rời hàng lên vòng (khớp `--otp-ring-in` trong shared-kit.css). */
export const OTP_RING_IN_MS = 250;
/** Một vòng quay (khớp `--otp-orbit`). */
export const OTP_ORBIT_MS = 800;
/**
 * Mốc dừng sớm nhất của vòng: lên vòng + trọn một vòng. Server trả lời nhanh cỡ nào người dùng
 * vẫn thấy trọn một vòng (Q-21).
 */
export const OTP_MIN_SPIN_MS = OTP_RING_IN_MS + OTP_ORBIT_MS;
/**
 * Từ lúc dừng vòng tới khi vòng xanh hiện (khớp nhịp trễ của `.otp-check::before` trong
 * shared-kit.css): mốc nơi gọi đổi tiêu đề + nút sang "Đã xác thực" — đổi sớm hơn thì chữ báo
 * xong trước khi ô kịp hội tụ.
 */
export const OTP_CONFIRM_AT_MS = 430;
/**
 * Từ lúc dừng vòng tới khi dấu tích hiện xong và giữ (khớp `.otp-check-mark`: trễ + thời lượng).
 */
export const OTP_SUCCESS_MS = 950;
/**
 * Chuỗi thành công không được giữ người dùng lâu hơn mức này dù `animationend` không tới (tab bị
 * ẩn, trình duyệt bỏ animation): cả chuỗi `OTP_SUCCESS_MS`, dư một nhịp.
 */
export const OTP_SUCCESS_FALLBACK_MS = OTP_SUCCESS_MS + 350;

/**
 * Dấu tích đứng yên được giữ bấy lâu khi bỏ chuyển động: không có `animationend` nào để chờ,
 * mà đi tiếp ngay thì người dùng không kịp thấy mã đã được nhận.
 */
export const OTP_STILL_HOLD_MS = 900;

/**
 * Còn chờ bao lâu tới mốc dừng vòng, khi vòng đã chạy `elapsed` ms. Chỉ dừng ở mốc TRỌN vòng:
 * dừng giữa chừng thì các ô đang nghiêng giật về tư thế đứng thẳng trước khi hội tụ.
 */
export function otpSealDelay(elapsed: number): number {
  if (elapsed < OTP_MIN_SPIN_MS) return OTP_MIN_SPIN_MS - elapsed;
  const into = (elapsed - OTP_RING_IN_MS) % OTP_ORBIT_MS;
  return into === 0 ? 0 : OTP_ORBIT_MS - into;
}

/** Môi trường không chạy animation CSS (không có `AnimationEvent`): không có gì để xem, đi tiếp ngay. */
function noCssAnimation(): boolean {
  return typeof window.AnimationEvent === 'undefined';
}

/**
 * Cửa chờ hiệu ứng thành công cho nơi gọi `OtpInput`: `if (!(await show())) return;` sau khi
 * server nhận mã, rồi mới điều hướng / đóng hộp / làm việc vừa được xác nhận.
 *
 * `show()` báo `true` khi hiệu ứng xong — `onShown` (ô báo vẽ xong) hoặc hẹn giờ dự phòng, để
 * một sự kiện bị lỡ không bao giờ chặn đăng nhập. Báo `false` khi bị hủy giữa chừng (`cancel()`,
 * component tháo, hoặc server trả lời sau khi đã tháo): việc chờ sau `show()` là việc người dùng
 * vừa bỏ — ghi két, mở ngăn — nên nơi gọi PHẢI dừng khi nhận `false`. Mọi hẹn giờ của hook bị dọn
 * cùng lượt hủy, không còn gì chạy hộ sau đó.
 *
 * Nhịp vòng quay do `OtpInput` giữ (nó biết vòng bắt đầu từ lúc nào); `confirmed` bật khi ô báo
 * vòng xanh đã hiện (`onConfirmed`) — nơi gọi dùng nó để đổi tiêu đề và nút sang "Đã xác thực".
 */
export function useOtpSuccess() {
  const [phase, setPhase] = useState<'idle' | 'success' | 'confirmed'>('idle');
  const finish = useRef<((shown: boolean) => void) | null>(null);
  const alive = useRef(true);
  const cancel = useCallback(() => {
    finish.current?.(false);
    if (alive.current) setPhase('idle');
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      finish.current?.(false);
    };
  }, []);
  const show = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        if (!alive.current) {
          resolve(false);
          return;
        }
        finish.current?.(false);
        if (noCssAnimation()) {
          setPhase('confirmed');
          resolve(true);
          return;
        }
        // Dự phòng: chờ mốc trọn vòng (≤ OTP_MIN_SPIN_MS) + cả chuỗi thành công, dư một nhịp.
        const timer = window.setTimeout(() => done(true), OTP_MIN_SPIN_MS + OTP_SUCCESS_FALLBACK_MS + 300);
        const done = (shown: boolean) => {
          window.clearTimeout(timer);
          if (finish.current === done) finish.current = null;
          resolve(shown && alive.current);
        };
        finish.current = done;
        setPhase('success');
      }),
    [],
  );
  const onShown = useCallback(() => finish.current?.(true), []);
  const onConfirmed = useCallback(() => setPhase((p) => (p === 'success' ? 'confirmed' : p)), []);
  const status = phase === 'idle' ? undefined : ('success' as const);
  return { status, show, cancel, onShown, onConfirmed, confirmed: phase === 'confirmed' };
}

/**
 * Nút gửi mã đi cùng `OtpInput` + `useOtpSuccess` (card đăng nhập, cài 2 lớp). Server đã nhận mã
 * mà vòng còn quay tới mốc trọn vòng thì nút vẫn "đang kiểm" chứ không quay về "Xác nhận"; vòng
 * xanh hiện mới đổi sang "Đã xác thực" (Q-21 mẫu "Glassy OTP").
 */
export function OtpSubmitButton({
  pending,
  otp,
}: {
  /** Lượt gửi mã đang chờ server. */
  pending: boolean;
  otp: Pick<ReturnType<typeof useOtpSuccess>, 'status' | 'confirmed'>;
}) {
  const { t } = useTranslation();
  const checking = pending || (otp.status === 'success' && !otp.confirmed);
  return (
    <button
      type="submit"
      className={otp.confirmed ? 'btn primary is-ok' : checking ? 'btn primary is-busy' : 'btn primary'}
      disabled={checking || otp.confirmed}
    >
      {otp.confirmed ? (
        <>
          <CheckIcon />
          {t('auth.otpVerified')}
        </>
      ) : checking ? (
        <>
          <span className="spinner" aria-hidden="true" />
          {t('auth.totpChecking')}
        </>
      ) : (
        t('auth.totpVerify')
      )}
    </button>
  );
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
  onConfirmed,
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
  /**
   * Gọi MỘT lần khi hiệu ứng thành công xong (bỏ chuyển động: sau khi giữ dấu tích đứng yên).
   * Có prop này = nơi gọi muốn hiệu ứng vòng → hàng ô chừa chỗ cho vòng (`has-ring`).
   */
  onSuccessShown?: () => void;
  /** Vòng xanh vừa hiện — `useOtpSuccess().onConfirmed`, để nơi gọi đổi tiêu đề/nút đúng nhịp. */
  onConfirmed?: () => void;
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

  // Server nhận mã rồi nhưng vòng vẫn quay tới mốc trọn vòng (`otpSealDelay`) mới hội tụ: vòng
  // chạy bằng CSS, chỉ JS biết nó bắt đầu từ lúc nào.
  const [sealed, setSealed] = useState(false);
  const visual: OtpStatus = state === 'success' && !sealed ? 'verifying' : state;
  // Lỗi của lượt trước giữ CHỖ (ẩn) trong lúc kiểm lượt mới: nơi gọi xoá lỗi khi gửi, dòng lỗi mất rồi
  // hiện lại làm khối co giãn một dòng — màn thấp thì thanh cuộn của trang bật tắt liên tục.
  const [staleError, setStaleError] = useState<string | null>(null);
  if (error && staleError !== error) setStaleError(error);
  if (!error && visual !== 'verifying' && staleError !== null) setStaleError(null);
  const busySince = useRef<number | null>(null);
  const prevVisual = useRef<OtpStatus>(visual);
  const [returning, setReturning] = useState(false);
  useLayoutEffect(() => {
    if (visual === 'verifying') busySince.current ??= Date.now();
    else busySince.current = null;
    // Sai mã giữa vòng: ô bay về hàng. Lỗi lúc không có vòng (bấm khi thiếu số) chỉ lắc.
    if (visual === 'error') {
      if (prevVisual.current === 'verifying') setReturning(true);
    } else setReturning(false);
    prevVisual.current = visual;
  }, [visual]);

  useEffect(() => {
    if (state !== 'success') {
      setSealed(false);
      return undefined;
    }
    if (noCssAnimation()) {
      setSealed(true);
      return undefined;
    }
    const timer = window.setTimeout(
      () => setSealed(true),
      otpSealDelay(Date.now() - (busySince.current ?? Date.now())),
    );
    return () => window.clearTimeout(timer);
  }, [state]);

  const shownCb = useRef(onSuccessShown);
  shownCb.current = onSuccessShown;
  const confirmedCb = useRef(onConfirmed);
  confirmedCb.current = onConfirmed;
  const shownOnce = useRef(false);
  const reportShown = useCallback(() => {
    if (shownOnce.current) return;
    shownOnce.current = true;
    shownCb.current?.();
  }, []);
  useEffect(() => {
    if (visual !== 'success') {
      shownOnce.current = false;
      return undefined;
    }
    if (noCssAnimation()) {
      confirmedCb.current?.();
      reportShown();
      return undefined;
    }
    const still = motionReduced();
    const confirm = window.setTimeout(() => confirmedCb.current?.(), still ? 0 : OTP_CONFIRM_AT_MS);
    const timer = window.setTimeout(reportShown, still ? OTP_STILL_HOLD_MS : OTP_SUCCESS_FALLBACK_MS);
    return () => {
      window.clearTimeout(confirm);
      window.clearTimeout(timer);
    };
  }, [visual, reportShown]);
  // Dấu tích hiện xong (animation cuối của chuỗi, đã gồm nhịp giữ) mới cho nơi gọi đi tiếp.
  // Nghe sự kiện gốc chứ không qua `onAnimationEnd` của React: React đoán tên sự kiện theo tiền tố
  // của trình duyệt, đoán sai là lỡ mất và người dùng phải chờ tới hẹn giờ dự phòng.
  const groupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = groupRef.current;
    if (visual !== 'success' || !el) return undefined;
    const onEnd = (e: Event) => {
      if ((e.target as Element).classList?.contains('otp-check-mark')) reportShown();
    };
    el.addEventListener('animationend', onEnd);
    return () => el.removeEventListener('animationend', onEnd);
  }, [visual, reportShown]);

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
        className={[
          'otp-boxes',
          onSuccessShown ? 'has-ring' : '',
          { idle: '', verifying: 'is-busy', success: 'is-success', error: 'is-error' }[visual],
          returning ? 'is-return' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="group"
        aria-busy={visual === 'verifying' ? true : undefined}
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
            // Thứ tự ô: vị trí trên vòng (góc = thứ tự × 60°) và quãng trượt từ hàng vào tâm.
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
        {visual === 'success' ? (
          <div className="otp-check">
            <svg className="otp-check-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
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
      ) : staleError ? (
        <span className="field-error is-stale" aria-hidden="true">
          {staleError}
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
