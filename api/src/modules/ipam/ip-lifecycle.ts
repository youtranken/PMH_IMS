/**
 * Vòng đời một địa chỉ IP (story 5.2, FR-019) — hàm THUẦN, không chạm DB.
 *
 * AC nói rõ: "chuyển trạng thái qua transition(), không UPDATE status tự do". Cái máy trạng
 * thái này là nơi DUY NHẤT biết đường nào đi được — service chỉ hỏi nó rồi ghi. Rải luật ra
 * mỗi endpoint một ít thì sáu tháng sau sẽ có một endpoint quên mất một nhánh, và trạng thái
 * sai không làm gì đỏ cả: nó chỉ lặng lẽ ngồi trong DB cho tới khi ai đó cấp trùng IP.
 *
 *      trống ──cấp──► đang cấp ──nghi ngờ──► nghi chết
 *                        │                      │
 *                        └──────thu hồi─────────┤
 *                                               ▼
 *                     đã thu hồi ◄──────────────┘
 *                        │
 *                        └──cấp lại──► đang cấp
 */

export const IP_LIFECYCLE_STATUSES = [
  'free',
  'assigned',
  'suspect_dead',
  'reclaimed',
] as const;
export type IpStatus = (typeof IP_LIFECYCLE_STATUSES)[number];

/**
 * Đường đi hợp lệ. Cố ý KHÔNG có:
 *  - `x → x`: đứng yên không phải một bước chuyển, cho phép thì mỗi lần bấm nhầm lại đẻ thêm
 *    một dòng lịch sử vô nghĩa và làm loãng đúng cái bảng người ta cần tra.
 *  - `* → free`: một địa chỉ đã có hồ sơ thì không quay về "chưa ai đụng tới" được nữa. Trả
 *    chỗ về pool là `reclaimed` — chỗ trống NHƯNG còn lịch sử, và lịch sử ấy chính là thứ
 *    AC 5.2 đòi giữ vĩnh viễn ("IP này từng là máy in kế toán").
 */
export const ALLOWED_TRANSITIONS: Record<IpStatus, IpStatus[]> = {
  free: ['assigned'],
  assigned: ['suspect_dead', 'reclaimed'],
  suspect_dead: ['assigned', 'reclaimed'],
  reclaimed: ['assigned'],
};

export function canTransition(from: IpStatus, to: IpStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(from: IpStatus): IpStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? [];
}

/**
 * Trạng thái đang CHIẾM một địa chỉ (FR-020 đếm mức sử dụng theo cái này).
 *
 * "Nghi chết" vẫn chiếm: chưa ai xác nhận máy chết thì chưa được cấp cho người khác — cấp
 * chồng lên một máy chỉ đang tắt là tạo ra xung đột IP, đúng thứ cuốn sổ này sinh ra để tránh.
 * "Đã thu hồi" thì không: trả chỗ về pool chính là ý nghĩa của thu hồi.
 */
export const OCCUPYING_STATUSES: IpStatus[] = ['assigned', 'suspect_dead'];

export function isOccupying(status: IpStatus): boolean {
  return OCCUPYING_STATUSES.includes(status);
}

/**
 * Tên thao tác bằng tiếng Việt — nút bấm và dòng lịch sử dùng chung một chữ.
 *
 * Đặt tên theo VIỆC NGƯỜI LÀM chứ không theo trạng thái đích: "Thu hồi" dễ hiểu hơn "chuyển
 * sang đã thu hồi", và `suspect_dead → assigned` là "Xác nhận vẫn dùng" chứ không phải "Cấp IP"
 * — cùng một đích nhưng là hai việc khác hẳn nhau trong đầu người dùng.
 */
export function transitionLabel(from: IpStatus, to: IpStatus): string {
  return TRANSITION_LABELS[`${from}->${to}`] ?? '';
}

const TRANSITION_LABELS: Record<string, string> = {
  'free->assigned': 'Cấp IP',
  'assigned->suspect_dead': 'Đánh dấu nghi chết',
  'assigned->reclaimed': 'Thu hồi',
  'suspect_dead->assigned': 'Xác nhận vẫn dùng',
  'suspect_dead->reclaimed': 'Thu hồi',
  'reclaimed->assigned': 'Cấp lại',
};
