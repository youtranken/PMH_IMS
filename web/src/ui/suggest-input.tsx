import { useMemo } from 'react';
import { Combobox } from '@/ui/combobox';

/**
 * Ô nhập chữ CÓ GỢI Ý từ một danh sách, nhưng vẫn gõ tự do được (AD-15).
 *
 * Dùng cho những ô mà danh mục chỉ nên HƯỚNG chứ không được ép: "Người / bộ phận dùng" của
 * một IP đôi khi là "P. Kế toán", đôi khi là "Chị Lan — Kế toán", đôi khi là hai phòng cùng
 * dùng chung một máy in. Ép thành khóa ngoại là ép người dùng khai sai cho vừa cái ô.
 *
 * Nhưng để trắng thì mỗi người gõ một kiểu ("P. Kế toán" / "Phòng Kế toán" / "KT") và lọc ra
 * thiếu. Gợi ý giải quyết đúng chỗ giữa: ai gõ hai chữ đầu là thấy ngay cách viết chuẩn.
 */
export function SuggestInput({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Cách viết chuẩn lấy từ danh mục. */
  options: string[];
  placeholder: string;
  ariaLabel: string;
}) {
  const term = value.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      // Đang gõ đúng một mục thì thôi gợi ý lại chính nó — menu che ô ngay sau khi chọn xong.
      options.filter(
        (option) =>
          option.toLowerCase() !== term && (!term || option.toLowerCase().includes(term)),
      ),
    [options, term],
  );

  return (
    <Combobox
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      query={value}
      onQuery={onChange}
      options={filtered}
      getKey={(option) => option}
      renderOption={(option) => <span>{option}</span>}
      onSelect={onChange}
    />
  );
}
