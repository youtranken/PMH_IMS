import { formatMoneyInput, parseMoneyInput } from '@/lib/money-input';

/**
 * Ô nhập tiền đồng có hậu tố "₫" cố định bên phải (SW-052).
 *
 * Ô chữ, không `type="number"`: phải nhận "5.600.000", "5,600,000" hay "5,6tr" như chép từ hóa
 * đơn (`lib/money-input`). Rời ô thì tự viết lại có dấu chấm hàng nghìn để soát bằng mắt. "₫"
 * nằm NGOÀI chữ trong ô để giá trị không lẫn đơn vị, và `aria-hidden` vì nhãn đã nói là tiền.
 *
 * Nhận `id`/`aria-*` từ `Field` (nó gắn cho component con) rồi chuyển xuống `<input>` thật.
 */
export function MoneyInput({
  value,
  onChange,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  return (
    <span className="input-affix">
      <input
        id={id}
        className="inp"
        inputMode="decimal"
        value={value}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const money = parseMoneyInput(value);
          if (money.reason === null && money.value !== null) onChange(formatMoneyInput(money.value));
        }}
      />
      <span className="input-affix-unit" aria-hidden="true">
        ₫
      </span>
    </span>
  );
}
