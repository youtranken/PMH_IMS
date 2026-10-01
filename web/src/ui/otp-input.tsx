import { useCallback, useRef, type Ref } from 'react';

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
 * và step-up xem bí mật (FR-022). Chỉ nhận chữ số, tự cắt còn 6, hỗ trợ dán từ clipboard.
 * `onComplete` gọi đúng lúc ô vừa đủ 6 số — nơi gọi gửi qua `useOtpSubmit` để không gửi đúp.
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
  /** Để nơi gọi đưa con trỏ về ô sau một lượt sai — giữ bàn phím số trên điện thoại mở. */
  inputRef?: Ref<HTMLInputElement>;
  /** Đang gửi mã: khoá ô để lượt gõ thêm không đè lên mã đang được kiểm. */
  readOnly?: boolean;
}) {
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label className="lbl-t" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        className="inp auth-otp"
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
        readOnly={readOnly}
        // inputMode numeric: điện thoại bật bàn phím số; autocomplete để iOS/Android
        // gợi ý mã từ tin nhắn/keychain.
        inputMode="numeric"
        autoComplete="one-time-code"
        /* Không `maxLength`: mã dán kèm khoảng trắng ("123 456") bị trình duyệt cắt còn
           "123 45" trước khi kịp lọc số — ô tự cắt còn 6 số ở `onChange`. */
        pattern="[0-9]{6}"
        autoFocus={autoFocus}
        required
        value={value}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, '').slice(0, 6);
          onChange(next);
          if (onComplete && otpJustCompleted(value, next)) onComplete(next);
        }}
      />
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
