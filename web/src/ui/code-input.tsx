import { forwardRef, type ChangeEvent, type InputHTMLAttributes } from 'react';

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Ô nhập MÃ (mã hồ sơ, serial, tên đăng nhập, số hợp đồng…) dùng chung (AD-15, FM-04).
 *
 * Bàn phím điện thoại mặc định viết hoa chữ đầu và tự sửa chữ: "sw-core" thành "Sw-core", "pmh"
 * thành "PMH." — mã sai mà người gõ không thấy. Ô này tắt cả hai và tắt kiểm chính tả (gạch đỏ
 * dưới mọi mã). `caps` bật bàn phím chữ HOA cho ô mã / serial, không ép dữ liệu thành chữ hoa.
 * `upper` (mã hồ sơ, PW-A12) thì ép: chữ gõ vào thành chữ hoa ngay, con trỏ giữ nguyên chỗ.
 */
export const CodeInput = forwardRef<HTMLInputElement, NativeProps & { caps?: boolean; upper?: boolean }>(
  function CodeInput({ caps = false, upper = false, className, onChange, ...props }, ref) {
    return (
      <input
        ref={ref}
        type="text"
        className={className ? `inp mono ${className}` : 'inp mono'}
        autoCapitalize={caps || upper ? 'characters' : 'none'}
        autoCorrect="off"
        spellCheck={false}
        {...props}
        onChange={
          upper
            ? (event: ChangeEvent<HTMLInputElement>) => {
                const input = event.target;
                const next = input.value.toUpperCase();
                // Sửa thẳng DOM trước khi báo lên: React nhận đúng giá trị đang hiện nên không
                // đặt lại ô (đặt lại là con trỏ nhảy về cuối).
                if (next !== input.value) {
                  const { selectionStart, selectionEnd } = input;
                  input.value = next;
                  input.setSelectionRange(selectionStart, selectionEnd);
                }
                onChange?.(event);
              }
            : onChange
        }
      />
    );
  },
);

/**
 * Bàn phím số trên iPhone tiếng Việt chỉ có DẤU PHẨY: "10,20,1,5" phải thành "10.20.1.5". Ô CIDR
 * nhận thêm "172.16.10.0 24" (bàn phím số không có "/") thành "/24".
 */
export function normalizeIp(raw: string, cidr = false): string {
  const dotted = raw.replace(/,/g, '.');
  return cidr ? dotted.replace(/^(\S+?)\s+(\d{1,3})$/, '$1/$2') : dotted;
}

/** Ô nhập địa chỉ IP / CIDR dùng chung (FM-05): bàn phím số, đổi "," → ".", mono. */
export const IpInput = forwardRef<HTMLInputElement, NativeProps & { cidr?: boolean }>(
  function IpInput({ cidr = false, onChange, ...props }, ref) {
    return (
      <CodeInput
        ref={ref}
        inputMode="decimal"
        {...props}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const next = normalizeIp(event.target.value, cidr);
          if (next !== event.target.value) event.target.value = next;
          onChange?.(event);
        }}
      />
    );
  },
);
