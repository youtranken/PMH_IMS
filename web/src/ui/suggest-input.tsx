import { useMemo } from 'react';
import { Combobox } from '@/ui/combobox';
import { foldSearch } from '@/lib/search-fold';

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
  failed,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Cách viết chuẩn lấy từ danh mục. */
  options: string[];
  /**
   * Danh mục HỎNG chứ không rỗng. Không nói ra thì mỗi người gõ một kiểu ("P. Kế toán" /
   * "Phòng Kế toán" / "KT") — đúng cái mà ô gợi ý này sinh ra để tránh.
   */
  failed?: boolean;
  placeholder: string;
  ariaLabel: string;
}) {
  // Gấp dấu cả hai vế (B-01): danh sách gợi ý là tên phòng ban, nhà cung cấp… toàn tiếng
  // Việt có dấu, nên gõ `ke toan` phải ra `Kế toán`.
  const term = foldSearch(value.trim());
  const filtered = useMemo(
    () =>
      // Đang gõ đúng một mục thì thôi gợi ý lại chính nó — menu che ô ngay sau khi chọn xong.
      // So bằng cũng phải gấp dấu, nếu không "Kế toán" gõ đủ dấu vẫn bị gợi ý lại chính nó.
      options.filter(
        (option) => foldSearch(option) !== term && (!term || foldSearch(option).includes(term)),
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
      failed={failed}
      getKey={(option) => option}
      renderOption={(option) => <span>{option}</span>}
      onSelect={onChange}
    />
  );
}
