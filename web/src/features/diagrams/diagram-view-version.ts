/**
 * Phiên bản tab Xem nạp khi URL không chỉ định. Mặc định là bản CHÍNH THỨC (Q-23 "Mở bản chính
 * thức"): mọi lối mở sơ đồ — panel, Ctrl+K, đường dẫn, khung bản vẽ con, link từ thiết bị — đều
 * không kèm `?version`, và server khi vắng `versionId` trả bản lưu MỚI NHẤT, có thể là nháp chưa
 * duyệt. Nháp xem bằng chỉ định rõ (`?version=`). `null` = để server chọn bản mới nhất.
 */
export function viewVersionOf(input: {
  mode: 'view' | 'edit';
  explicit: string | null;
  official: string | null | undefined;
}): string | null {
  if (input.mode !== 'view') return null;
  if (input.explicit) return input.explicit;
  return input.official ?? null;
}
