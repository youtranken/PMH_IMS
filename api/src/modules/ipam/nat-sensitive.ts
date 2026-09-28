/**
 * Danh sách cổng "nhạy cảm" (`nat.sensitive_ports`, 0140) → mảng số tăng dần, không trùng.
 *
 * Một mục gõ hỏng (chữ, ngoài 1–65535) bị BỎ QUA chứ không làm cả danh sách rỗng: sổ NAT mất
 * hết huy hiệu "Nhạy cảm" chỉ vì một dấu phẩy thừa là im lặng tắt đúng cái cảnh báo cần nhất.
 */
export function sensitivePortsOf(text: string): number[] {
  const ports = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\d{1,5}$/.test(part))
    .map(Number)
    .filter((port) => port >= 1 && port <= 65535);
  return [...new Set(ports)].sort((a, b) => a - b);
}
