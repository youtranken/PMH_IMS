/**
 * Khung xin–duyệt dùng chung (story 6.1, AD-6) — hàm THUẦN, không chạm DB.
 *
 * AD-6: "mọi luồng xin–duyệt dùng bảng `approval` chung + từ vựng state ĐĂNG KÝ THEO LOẠI;
 * state đổi qua `transition()` khai báo, cấm UPDATE status tự do."
 *
 * Nghĩa là loại yêu cầu tự mang máy trạng thái của mình tới, còn module `approvals` chỉ biết
 * cách chạy một máy trạng thái bất kỳ. Break-glass (Epic 6) và phiếu ISO (Epic 8) sẽ có từ
 * vựng khác hẳn nhau — nhét cả hai vào một enum cứng là bắt đầu con đường quen thuộc:
 * `status text` với mười giá trị mà nửa số đó chỉ dùng cho một loại.
 */

export interface ApprovalFlowSpec {
  /** Khóa loại: 'break_glass', 'iso_form', … */
  kind: string;
  initial: string;
  /** state → những state đi tiếp được. State cuối khai mảng rỗng. */
  transitions: Record<string, string[]>;
  /** Nhãn tiếng Việt cho từng bước, khóa `'from->to'`. Dùng cho nút bấm VÀ dòng lịch sử. */
  labels: Record<string, string>;
}

export class ApprovalFlow {
  constructor(private readonly spec: ApprovalFlowSpec) {}

  get kind(): string {
    return this.spec.kind;
  }

  get initial(): string {
    return this.spec.initial;
  }

  /**
   * Đứng yên (`x → x`) KHÔNG hợp lệ, và state lạ cũng không.
   *
   * State lạ đáng nói riêng: dữ liệu cũ sau một migration, hoặc một bản ghi của LOẠI KHÁC bị
   * đưa nhầm vào đây. Tra trong bảng của chính loại này nên cả hai đều rơi ra ngoài, không có
   * đường "chắc là được".
   */
  can(from: string, to: string): boolean {
    if (from === to) return false;
    return this.spec.transitions[from]?.includes(to) ?? false;
  }

  next(from: string): string[] {
    return this.spec.transitions[from] ?? [];
  }

  isFinal(state: string): boolean {
    return this.next(state).length === 0;
  }

  label(from: string, to: string): string {
    return this.spec.labels[`${from}->${to}`] ?? '';
  }

  /** Câu chỉ đường cho thông điệp lỗi — liệt kê đúng việc làm được từ đây. */
  describeNext(from: string): string {
    return this.next(from)
      .map((to) => this.label(from, to))
      .filter(Boolean)
      .join(', ');
  }
}

/**
 * AD-6, câu gắt nhất của cả tài liệu: **"hiệu lực kiểm tại MỖI lần đọc bằng `expires_at >
 * now()` — KHÔNG tin status"**.
 *
 * Vì sao phải gắt: sweep dọn grant hết hạn có thể chết, chạy trễ, hoặc bị tắt lúc bảo trì.
 * Tin `status = 'approved'` thì một grant 24 giờ lặng lẽ thành grant vĩnh viễn chỉ vì cron
 * không chạy — và không ai phát hiện, vì trên màn hình mọi thứ trông vẫn bình thường. Kiểm
 * bằng đồng hồ thì grant tự chết đúng giờ kể cả khi toàn bộ phần còn lại của hệ thống quên nó.
 *
 * `sweep` chỉ để VỆ SINH (đổi status cho danh sách đọc gọn), không phải để cắt quyền.
 */
export function isGrantActive(
  status: string,
  expiresAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (status !== 'approved') return false;
  // Đã duyệt mà không có hạn là dữ liệu hỏng — từ chối, KHÔNG coi là vô hạn.
  if (expiresAt === null) return false;
  return expiresAt.getTime() > now.getTime();
}

/**
 * Yêu cầu treo quá lâu chưa ai xử → nhắc (story 6.1).
 *
 * `>=` chứ không `>`: sweep có thể lỡ nhịp, và với `>` thì lỡ đúng khoảnh khắc là mất luôn
 * lần nhắc — cùng bài học của `shouldSendNow` ở Epic 3.
 *
 * Ngưỡng 0 nghĩa là TẮT nhắc. Không có nhánh này thì `0` biến thành "mọi thứ đều quá hạn" và
 * người duyệt lãnh một email mỗi phút — cách nhanh nhất để họ lọc hết vào thùng rác.
 */
export function overdueSince(
  createdAt: Date,
  thresholdHours: number,
  now: Date = new Date(),
): boolean {
  if (thresholdHours <= 0) return false;
  return now.getTime() - createdAt.getTime() >= thresholdHours * 3_600_000;
}
