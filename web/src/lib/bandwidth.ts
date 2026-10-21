/**
 * Tốc độ gói cước để HIỂN THỊ (PW-A15). Ô nhập là chữ tự do (đường truyền ghi "300 Mbps",
 * "100/50 Mbps", "1 Gbps"…); người gõ chỉ một con số thì màn hình nói thêm đơn vị mặc định
 * của nhà mạng Việt Nam là Mbps — không sửa dữ liệu đã lưu.
 */
export function bandwidthLabel(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  return /^\d+(?:[.,]\d+)?$/.test(text) ? `${text} Mbps` : text;
}
