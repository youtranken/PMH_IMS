import { daysUntil } from '@/lib/expiry';
import type { DeviceStatus } from '@/lib/device-types';

/**
 * Ngày hết bảo hành cần NHẮC trên máy đang Hỏng — `null` khi không có gì để nhắc.
 *
 * Chỉ máy Hỏng: máy chạy tốt thì "còn bảo hành" không dẫn tới việc gì. Hạn hôm nay vẫn tính
 * là còn (`daysUntil` = 0), vì hôm nay vẫn gọi NCC được.
 */
export function warrantyNudgeEnd(
  status: DeviceStatus,
  warrantyEnd: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (status !== 'broken' || !warrantyEnd) return null;
  return daysUntil(warrantyEnd, now) >= 0 ? warrantyEnd : null;
}

export interface HeldCount<K extends string = string> {
  key: K;
  /** `undefined` = chưa biết (đang tải, không có quyền) — KHÔNG phải 0. */
  count: number | undefined;
}

/** Hàng "Đang giữ": chỉ những thứ máy thật sự giữ; chưa biết thì im, không nói 0. */
export function heldSummary<K extends string>(
  items: HeldCount<K>[],
): { key: K; count: number }[] {
  return items.filter((item): item is { key: K; count: number } => (item.count ?? 0) > 0);
}
