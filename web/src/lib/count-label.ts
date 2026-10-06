/**
 * Nhãn đếm viết HOA danh từ sau số vì nó đứng đầu cụm ("1 Tủ mạng", Q-24). Cùng nhãn đó ghép vào
 * GIỮA câu ("Đang dùng ở 1 tủ mạng — …") thì danh từ phải về chữ thường: luật viết hoa chỉ áp ở
 * đầu cụm. Chỉ hạ chữ hoa đứng trước chữ thường, nên chữ viết tắt (IP, NAT) giữ nguyên.
 */
export function lowerFirstAfterNumber(text: string): string {
  return text.replace(/(\d[\d.,]*\s+)(\p{Lu})(?=\p{Ll})/gu, (_, lead: string, ch: string) => lead + ch.toLowerCase());
}
