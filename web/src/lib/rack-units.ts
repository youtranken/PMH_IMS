/**
 * Cách đọc vị trí U trong tủ — cùng chữ với nhãn ô trên bản vẽ và lời báo lệch kho của server
 * (`api/src/common/rack-units.ts`): "U5" hoặc "U5–U6". U1 ở đáy tủ; `start` là U thấp nhất.
 */
export function rackUnitLabel(start: number | null | undefined, size: number | null | undefined): string | null {
  if (start === null || start === undefined) return null;
  const units = size && size > 1 ? size : 1;
  return units === 1 ? `U${start}` : `U${start}–U${start + units - 1}`;
}
