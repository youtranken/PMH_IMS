/**
 * Vòng đời một địa chỉ IP (story 5.2, FR-019, Q-02) — hàm THUẦN, không chạm DB.
 *
 * AC nói rõ: "chuyển trạng thái qua transition(), không UPDATE status tự do". Cái máy trạng
 * thái này là nơi DUY NHẤT biết đường nào đi được — service chỉ hỏi nó rồi ghi. Rải luật ra
 * mỗi endpoint một ít thì sáu tháng sau sẽ có một endpoint quên mất một nhánh, và trạng thái
 * sai không làm gì đỏ cả: nó chỉ lặng lẽ ngồi trong DB cho tới khi ai đó cấp trùng IP.
 *
 *      trống ──Cấp IP──► đang dùng
 *        ▲                   │
 *        └─────Thu hồi───────┘
 *
 * Chỉ hai trạng thái (Q-02). "Đã thu hồi" không cần là một trạng thái riêng: câu "IP này từng
 * là máy in kế toán" do `ip_history` trả lời, không phải cột `status`. Và không có "nghi
 * chết" vì không có gì tự đo được điều đó — ping bị Windows chặn mặc định nên sẽ báo sai.
 */

export const IP_LIFECYCLE_STATUSES = ['free', 'assigned'] as const;
export type IpStatus = (typeof IP_LIFECYCLE_STATUSES)[number];

/**
 * Đường đi hợp lệ. Cố ý KHÔNG có `x → x`: đứng yên không phải một bước chuyển, cho phép thì
 * mỗi lần bấm nhầm lại đẻ thêm một dòng lịch sử vô nghĩa và làm loãng đúng cái bảng người ta
 * cần tra.
 */
export const ALLOWED_TRANSITIONS: Record<IpStatus, IpStatus[]> = {
  free: ['assigned'],
  assigned: ['free'],
};

export function canTransition(from: IpStatus, to: IpStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(from: IpStatus): IpStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? [];
}

/** Trạng thái đang CHIẾM một địa chỉ (FR-020 đếm mức sử dụng theo cái này). */
export const OCCUPYING_STATUSES: IpStatus[] = ['assigned'];

export function isOccupying(status: IpStatus): boolean {
  return OCCUPYING_STATUSES.includes(status);
}

/**
 * Tên thao tác bằng tiếng Việt — nút bấm và cột `action` của `ip_history` dùng chung một chữ.
 *
 * Đặt tên theo VIỆC NGƯỜI LÀM chứ không theo trạng thái đích: "Thu hồi" dễ hiểu hơn "chuyển
 * sang trống". "Thu hồi" cũng là chữ các dòng lịch sử cũ đã mang, nên tra theo cột `action`
 * vẫn ra cả dòng cũ lẫn dòng mới.
 */
export function transitionLabel(from: IpStatus, to: IpStatus): string {
  return TRANSITION_LABELS[`${from}->${to}`] ?? '';
}

const TRANSITION_LABELS: Record<string, string> = {
  'free->assigned': 'Cấp IP',
  'assigned->free': 'Thu hồi',
};
