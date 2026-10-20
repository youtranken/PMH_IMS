const HOUR_STEPS = [1, 2, 4, 8, 24];

/**
 * Nấc giờ chọn nhanh của hộp Xin mở két, không vượt `limit` (trần `breakglass.max_grant_hours`)
 * và luôn kết thúc ĐÚNG bằng `limit`. Không rõ giới hạn thì chỉ đưa các nấc ngắn: đoán to là mở
 * két lâu hơn cần.
 */
export function hourSteps(limit: number | null | undefined): number[] {
  if (!limit || limit <= 0) return [1, 2, 4];
  return [...HOUR_STEPS.filter((h) => h < limit), limit];
}

/** Số giờ đã xin trên phiếu, `null` khi phiếu không mang số nguyên dương. */
export function requestedHours(payload: { hours?: unknown } | null | undefined): number | null {
  const hours = Number(payload?.hours);
  return Number.isInteger(hours) && hours > 0 ? hours : null;
}
