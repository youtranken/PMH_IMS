import { clampPage } from '@/lib/paging';
import { foldSearch } from '@/lib/search-fold';
import { STATUS_KEY, type IpRow, type IpStatus, type SubnetSlot } from './ipam-types';

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
 * Chip "Đã ngừng dùng" — chỉ bày ở dải ĐÃ NGỪNG DÙNG, nơi API trả kèm hồ sơ tắt cùng dải.
 *
 * Tách khỏi `SLOT_FILTERS` vì dải đang dùng không bao giờ có hồ sơ tắt trên màn (hồ sơ nhập
 * nhầm bị xóa hẳn khỏi màn, Q-15): bày chip thường trực là mời bấm vào một rổ luôn rỗng.
 */
export const VOIDED_FILTER: SlotFilter = 'voided';

/**
 * Nhãn của từng rổ — `STATUS_KEY` cộng thêm rổ "đã ngừng dùng".
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

/**
 * Ô tìm ngay trên bảng IP — lọc tại chỗ vì cả dải (≤254 ô) đã nằm trong bộ nhớ.
 *
 * Ô trống chỉ có địa chỉ nên chỉ khớp theo địa chỉ; hồ sơ thì khớp thêm máy, người dùng và
 * ghi chú — đúng những câu người ta hỏi: "10.77.1.53 là của ai", "máy chủ file ở IP nào".
 */
export function searchSlots(slots: SubnetSlot[], query: string): SubnetSlot[] {
  const needle = foldSearch(query.trim());
  if (!needle) return slots;
  return slots.filter((slot) => {
    const fields =
      slot.kind === 'free'
        ? [slot.address]
        : [slot.address, slot.deviceCode, slot.deviceName, slot.usedBy, slot.note];
    return fields.some((field) => field && foldSearch(field).includes(needle));
  });
}

/**
 * Chỗ trống có địa chỉ nhỏ nhất, bỏ qua gateway — nút "Cấp IP trống kế tiếp".
 *
 * Trả kèm hồ sơ khi chỗ trống là một hồ sơ đã thu hồi: cấp lại đúng hồ sơ đó để lịch sử "IP
 * này từng của ai" nối tiếp, cùng đường với nút Cấp IP trên dòng. `slots` đã xếp theo địa chỉ.
 */
export function nextFreeSlot(
  slots: SubnetSlot[],
  gateway: string | null,
): { address: string; record: IpRow | null } | null {
  for (const slot of slots) {
    if (slotStatus(slot) !== 'free' || slot.address === gateway) continue;
    return { address: slot.address, record: slot.kind === 'record' ? slot : null };
  }
  return null;
}

/**
 * Mọi chỗ trống cấp được (cùng luật `nextFreeSlot`: bỏ gateway, bỏ hồ sơ đã ẩn) — ô đổi địa
 * chỉ trong hộp Cấp IP. Hồ sơ Trống đi kèm bản ghi để cấp lại đúng hồ sơ đó.
 */
export function freeChoices(
  slots: SubnetSlot[],
  gateway: string | null,
): { address: string; record: IpRow | null }[] {
  return slots
    .filter((slot) => slotStatus(slot) === 'free' && slot.address !== gateway)
    .map((slot) => ({ address: slot.address, record: slot.kind === 'record' ? slot : null }));
}

/** Trang (tính từ 1) chứa địa chỉ này trong danh sách đang hiện; không có thì `null`. */
export function pageOfAddress(
  slots: SubnetSlot[],
  address: string,
  limit = SLOT_PAGE_SIZE,
): number | null {
  const index = slots.findIndex((slot) => slot.address === address);
  return index < 0 ? null : Math.floor(index / limit) + 1;
}
