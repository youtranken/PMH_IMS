import { formatPhone } from '@/lib/phone-format';

/**
 * Bỏ khỏi chuỗi gõ/dán mọi ký tự không thuộc số điện thoại (Q-18): giữ chữ số, dấu cách, và
 * MỘT dấu `+` nếu nó đứng đầu. Dấu cách giữ lại để người gõ chia nhóm cho dễ soát; API bỏ
 * chúng khi lưu.
 */
export function filterPhoneTyping(text: string): string {
  const kept = text.replace(/[^\d +]/g, '');
  const leadingPlus = /^\s*\+/.test(kept);
  const body = kept.replace(/\+/g, '');
  return leadingPlus ? `+${body.trimStart()}` : body;
}

/**
 * Ô số điện thoại dùng chung (Q-18): danh mục (nhà cung cấp, nhà mạng), đường truyền, người
 * dùng IMS.
 *
 * Lọc NGAY khi gõ thay vì đợi API trả 400: người dùng thấy ký tự lạ không vào ô là hiểu luật,
 * còn một câu lỗi sau khi bấm Lưu thì bắt họ đoán ký tự nào sai. API vẫn kiểm lại
 * (`api/src/common/phone.ts`) — ô này không phải hàng rào duy nhất.
 *
 * Nhận `id`/`aria-*` từ `Field` (nó gắn cho component con) rồi chuyển xuống `<input>` thật.
 */
export function PhoneInput({
  value,
  onChange,
  id,
  className = 'inp mono',
  placeholder,
  maxLength,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  maxLength?: number;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  return (
    <input
      id={id}
      className={className}
      type="tel"
      inputMode="tel"
      placeholder={placeholder}
      maxLength={maxLength}
      value={value}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      onChange={(e) => onChange(filterPhoneTyping(e.target.value))}
      // Rời ô thì tách nhóm như chỗ hiển thị, để người gõ soát lại được; API bỏ dấu cách khi lưu.
      onBlur={() => onChange(formatPhone(value))}
    />
  );
}
