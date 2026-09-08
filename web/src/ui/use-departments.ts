import { useCatalogLists } from '@/ui/use-catalog-lists';

/**
 * Tên bộ phận đang dùng, để gợi ý cho các ô "ai đang dùng".
 *
 * Chỉ lấy mục CÒN HIỆU LỰC: phòng đã giải thể vẫn phải đọc được trong hồ sơ cũ (nên không
 * xóa), nhưng không được gợi ý cho bản ghi mới — đó chính là ý nghĩa của việc vô hiệu.
 *
 * TRẢ VỀ CẢ CỜ HỎNG, KHÔNG CHỈ MẢNG TÊN.
 *
 * Bản trước trả `string[]`. Khi `/api/v1/catalog` hỏng, mảng đó rỗng, và nơi gọi — 6 chỗ,
 * trên 4 màn — KHÔNG CÓ ĐƯỜNG NÀO biết được là nó rỗng vì hỏng hay vì chưa khai phòng ban
 * nào. Cả 6 ô gợi ý im lặng như nhau, nên mỗi người tự gõ một cách viết ("P. Kế toán" /
 * "Phòng Kế toán" / "KT") — đúng cái mà chú thích của `SuggestInput` nói nó sinh ra để tránh,
 * và lọc theo bộ phận về sau sẽ ra thiếu.
 *
 * Trả về object chứ không phải tuple: nơi gọi buộc phải đặt tên cho cả hai vế, nên không thể
 * "quên" cờ hỏng bằng cách bỏ bớt phần tử thứ hai.
 */
export function useDepartments(): { names: string[]; failed: boolean } {
  const lists = useCatalogLists();
  return {
    names: (lists.data?.departments ?? [])
      .filter((department) => department.active)
      .map((department) => department.name),
    failed: lists.isError,
  };
}
