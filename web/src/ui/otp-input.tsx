/**
 * Ô nhập mã 6 số dùng chung (AD-15) — dùng ở: nhập TOTP lúc đăng nhập, xác nhận enroll,
 * và step-up xem bí mật (FR-022). Chỉ nhận chữ số, tự cắt còn 6, hỗ trợ dán từ clipboard.
 */
export function OtpInput({
  value,
  onChange,
  label,
  autoFocus = true,
  id = 'otp',
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  autoFocus?: boolean;
  id?: string;
}) {
  return (
    <div className="field">
      <label className="lbl-t" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="inp auth-otp"
        // inputMode numeric: điện thoại bật bàn phím số; autocomplete để iOS/Android
        // gợi ý mã từ tin nhắn/keychain.
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        autoFocus={autoFocus}
        required
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </div>
  );
}
