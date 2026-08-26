import type { IpStatus, SubnetSlot } from './ipam-types';

/** Bộ lọc trạng thái của màn dải — "tất cả" là một lựa chọn ngang hàng với bốn trạng thái. */
export type SlotFilter = 'all' | IpStatus;

export const SLOT_FILTERS: SlotFilter[] = [
  'all',
  'assigned',
  'free',
  'suspect_dead',
  'reclaimed',
];

/** Mỗi trang 50 dòng. Dải rộng nhất là /24 = 254 host, nên nhiều nhất 6 trang. */
export const SLOT_PAGE_SIZE = 50;

/**
 * Trạng thái của một ô trong dải.
 *
 * Ô CHƯA CÓ HỒ SƠ (`kind: 'free'`) và ô có hồ sơ mang trạng thái `free` là hai chuyện khác
 * nhau trong DB nhưng GIỐNG NHAU với người đọc: cả hai đều là "chỗ này đang trống". Gộp ở
 * đúng một chỗ này để bộ lọc, con số đếm và bảng không bao giờ trả lời lệch nhau.
 */
export function slotStatus(slot: SubnetSlot): IpStatus {
  return slot.kind === 'free' ? 'free' : slot.status;
}

export function filterSlots(slots: SubnetSlot[], filter: SlotFilter): SubnetSlot[] {
  if (filter === 'all') return slots;
  return slots.filter((slot) => slotStatus(slot) === filter);
}

/**
 * Đếm cho từng nút lọc.
 *
 * Con số nằm NGAY TRÊN NÚT chứ không bắt bấm vào mới biết: câu hỏi "còn mấy chỗ trống" phải
 * trả lời được bằng một cái liếc, đó là lý do màn này tồn tại.
 */
export function countSlots(slots: SubnetSlot[]): Record<SlotFilter, number> {
  const counts: Record<SlotFilter, number> = {
    all: slots.length,
    assigned: 0,
    free: 0,
    suspect_dead: 0,
    reclaimed: 0,
  };
  for (const slot of slots) counts[slotStatus(slot)] += 1;
  return counts;
}

/**
 * Kéo số trang về khoảng còn tồn tại.
 *
 * Đang ở trang 5 của "Tất cả" rồi bấm sang "Nghi chết" (chỉ có 3 dòng) mà giữ nguyên trang 5
 * thì bảng rỗng trơn — người dùng kết luận là không có dòng nào, trong khi có ba dòng ở
 * trang 1. Danh sách rỗng thật thì vẫn là trang 1, không phải trang 0.
 */
export function clampPage(page: number, total: number, limit = SLOT_PAGE_SIZE): number {
  const lastPage = Math.max(1, Math.ceil(total / limit));
  return Math.min(Math.max(1, page), lastPage);
}

/** Lát cắt của một trang. Trang vượt khoảng được kéo về trước, nên không bao giờ trả rỗng oan. */
export function pageSlots(
  slots: SubnetSlot[],
  page: number,
  limit = SLOT_PAGE_SIZE,
): SubnetSlot[] {
  const safe = clampPage(page, slots.length, limit);
  return slots.slice((safe - 1) * limit, safe * limit);
}
