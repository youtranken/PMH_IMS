import { clampPage } from '@/lib/paging';
import { STATUS_KEY, type IpStatus, type SubnetSlot } from './ipam-types';

/**
 * Rổ của một ô trên màn dải.
 *
 * `'voided'` KHÔNG phải một `IpStatus` — trong DB nó là cột `voided_at`, một tầng nằm cạnh
 * `status` chứ không nằm trong nó. Nhưng với người đọc bảng thì nó là một rổ ngang hàng với
 * các trạng thái kia, vì câu hỏi họ đang hỏi là "ô này dùng được không".
 */
export type SlotBucket = IpStatus | 'voided';

/** Bộ lọc trạng thái của màn dải — "tất cả" là một lựa chọn ngang hàng với các rổ. */
export type SlotFilter = 'all' | SlotBucket;

export const SLOT_FILTERS: SlotFilter[] = ['all', 'assigned', 'free'];

/**
 * Chip "Đã ẩn" chỉ xuất hiện khi người dùng đã bật ô tick "Hiện cả hồ sơ đã ẩn" (B-04).
 *
 * Tách khỏi `SLOT_FILTERS` vì hồ sơ đã ẩn chỉ được API trả về khi `?includeVoided=true`: bày
 * một chip "Đã ẩn 0" thường trực là mời người dùng bấm vào một rổ luôn rỗng, rồi tự kết luận
 * rằng dải này không có hồ sơ nào bị ẩn — đúng cái kết luận sai mà B-04 đang sửa.
 */
export const VOIDED_FILTER: SlotFilter = 'voided';

/**
 * Nhãn của từng rổ — `STATUS_KEY` cộng thêm rổ "đã ẩn".
 *
 * Dùng LẠI `ipam.voidedBadge`, chính khoá mà huy hiệu trên hàng đang đọc: chip lọc và huy hiệu
 * nói về cùng một thứ, nên hai chữ khác nhau cho nó là đúng lỗi mà `term-consistency.test.ts`
 * vừa dọn sáu lần.
 */
export const BUCKET_KEY: Record<SlotBucket, string> = {
  ...STATUS_KEY,
  voided: 'ipam.voidedBadge',
};

/** Mỗi trang 50 dòng. Dải rộng nhất là /24 = 254 host, nên nhiều nhất 6 trang. */
export const SLOT_PAGE_SIZE = 50;

/**
 * Khi nào thì màn chi tiết tự mở sẵn bộ lọc "Đang dùng" thay vì đổ ra cả bãi ô trống.
 *
 * Phải thỏa CẢ HAI, và mỗi vế chặn một kiểu chọn-hộ-sai:
 *
 * · `BURIED_FREE` (32 ≈ một dải /27) — dưới mức này cả dải vẫn lọt trong một trang, mắt tự
 *   quét được, và chọn hộ chỉ tổ giấu đi mấy ô trống mà người ta vào để bấm "Cấp IP này".
 *
 * · `WORTH_ISOLATING` (5) — một /24 vừa khai, mới cấp đúng một địa chỉ thì KHÔNG có gì đang
 *   bị chôn cả: người mở nó ra gần như chắc chắn đang muốn cấp tiếp, và giấu 253 ô trống đi
 *   là lấy mất đúng thứ họ cần. Chuyện "12 dòng dữ liệu nằm rải trong sáu trang ô trống" chỉ
 *   thành vấn đề khi trong dải đã có một lượng hồ sơ thật sự.
 */
export const BURIED_FREE = 32;
export const WORTH_ISOLATING = 5;

/**
 * Luật quyết định, tách thành HÀM THUẦN để kiểm được bằng bảng dữ liệu.
 *
 * Trước 18/09 nó là một biểu thức viết thẳng trong JSX của `subnet-detail.tsx`, nên không có
 * đường nào hỏi nó bốn ca biên (4/33 · 5/32 · 5/33 · 5/253) mà không dựng cả màn hình lên.
 * Hai hằng số thì export sẵn từ lâu; chỉ mỗi phép so là kẹt trong component.
 */
export function shouldIsolateAssigned(assigned: number, free: number): boolean {
  return assigned >= WORTH_ISOLATING && free > BURIED_FREE;
}

/**
 * Trạng thái của một ô trong dải.
 *
 * Ô CHƯA CÓ HỒ SƠ (`kind: 'free'`) và ô có hồ sơ mang trạng thái `free` là hai chuyện khác
 * nhau trong DB nhưng GIỐNG NHAU với người đọc: cả hai đều là "chỗ này đang trống". Gộp ở
 * đúng một chỗ này để bộ lọc, con số đếm và bảng không bao giờ trả lời lệch nhau.
 */
export function slotStatus(slot: SubnetSlot): SlotBucket {
  if (slot.kind === 'free') return 'free';
  /*
   * `voided_at` thắng `status`, và đó là cả điểm của B-04 (23/09).
   *
   * Hồ sơ bị ẩn giữ nguyên `status` cũ trong DB — phần lớn là `'free'`. Hàm này trước đây chỉ
   * đọc `status`, nên một hồ sơ đã ẩn rơi vào rổ "Trống": chip đếm nó là chỗ trống, bấm lọc
   * "Trống" thì nó hiện lên trong kết quả, và người dùng cấp đè lên một địa chỉ đang mang
   * lịch sử — trong khi thẻ dải ngay phía trên nói "Giữ lại vì còn 1 hồ sơ IP mang lịch sử".
   *
   * Hỏi ở ĐÂY chứ không ở `countSlots` hay `filterSlots`: vá một trong hai thì con số đúng mà
   * bộ lọc vẫn sai, hoặc ngược lại. Chú thích của chính hàm này đã nói trước chỗ đúng.
   */
  if (slot.voidedAt) return 'voided';
  return slot.status;
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
    voided: 0,
  };
  for (const slot of slots) counts[slotStatus(slot)] += 1;
  return counts;
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
