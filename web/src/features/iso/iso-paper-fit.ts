/**
 * Hệ số thu nhỏ bản giấy ISO để thấy ĐỦ trang trong khung (không bao giờ phóng to). Bản giấy vẽ
 * đúng bề rộng khổ giấy rồi thu cả khối: để trình duyệt tự co thì bảng 0206 trên điện thoại bị bóp
 * đến chồng chữ, và lưới 0203 A3 ngang trên desktop khuất ngày 30–31 sau một vùng cuộn không ai thấy.
 */
export function paperZoom(available: number, natural: number): number {
  if (available <= 0 || natural <= 0) return 1;
  return Math.min(1, available / natural);
}
