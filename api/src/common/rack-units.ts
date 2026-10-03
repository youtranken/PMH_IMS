/**
 * Cách đọc vị trí U trong tủ — MỘT bản cho mọi nơi hiện nó (hồ sơ thiết bị, nhãn ô trên bản vẽ,
 * khung tủ, cảnh báo lệch kho), để "U5–U6" ở trang thiết bị và trên bản vẽ là một chữ.
 * U1 ở đáy tủ; `start` là U thấp nhất máy chiếm.
 */
export function rackUnitLabel(start: number | null | undefined, size: number | null | undefined): string | null {
  if (start === null || start === undefined) return null;
  const units = size && size > 1 ? size : 1;
  return units === 1 ? `U${start}` : `U${start}–U${start + units - 1}`;
}
