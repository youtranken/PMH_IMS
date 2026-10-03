/**
 * Chia cổng cho "Nối hàng loạt" (Story 10.5) — hàm THUẦN, test bảng dữ liệu ở `port-plan.spec.ts`.
 * Màn xem trước và lượt ghi cùng gọi hàm này (qua route `bulk-plan` và trong `tx` của
 * `bulk-link`), nên bảng "máy → cổng" người dùng duyệt là đúng bảng được ghi.
 */

/** Nhãn cổng kế tiếp: tăng số CUỐI của nhãn, giữ độ rộng nếu có số 0 đứng đầu; không có số → `''`. */
export function nextPortLabel(label: string): string {
  const match = /^(.*?)(\d+)$/.exec(label.trim());
  if (!match) return '';
  const digits = match[2];
  return `${match[1]}${String(Number(digits) + 1).padStart(digits.length, '0')}`;
}

export type BulkPlanReason = 'no-targets' | 'start-not-numbered' | 'end-mismatch' | 'not-enough';

export interface BulkPlanInput {
  start: string;
  /** Cổng cuối của dải được dùng; vắng = đi tiếp tới khi đủ cổng. */
  end?: string | null;
  count: number;
  /** Nhãn cổng đã chiếm, viết thường (luật một cổng một cáp không phân biệt hoa/thường — Q-20). */
  taken: Set<string>;
}

/** Một hình dạng trả về (web không bật `strict`): `ports` rỗng khi có `reason`. */
export function planBulkPorts(input: BulkPlanInput): { ports: string[]; reason: BulkPlanReason | null } {
  if (input.count <= 0) return { ports: [], reason: 'no-targets' };
  const start = /^(.*?)(\d+)$/.exec(input.start.trim());
  if (!start) return { ports: [], reason: 'start-not-numbered' };
  let last = Number.POSITIVE_INFINITY;
  if (input.end && input.end.trim()) {
    const end = /^(.*?)(\d+)$/.exec(input.end.trim());
    if (!end || end[1].toLowerCase() !== start[1].toLowerCase() || Number(end[2]) < Number(start[2])) {
      return { ports: [], reason: 'end-mismatch' };
    }
    last = Number(end[2]);
  }
  const ports: string[] = [];
  let label = input.start.trim();
  // Không có cổng cuối thì vòng này luôn dừng: mỗi bước hoặc lấy một cổng, hoặc bỏ một cổng đã chiếm.
  for (let guard = 0; ports.length < input.count && guard <= input.count + input.taken.size; guard += 1) {
    const number = Number(/(\d+)$/.exec(label)![1]);
    if (number > last) break;
    if (!input.taken.has(label.toLowerCase())) ports.push(label);
    label = nextPortLabel(label);
  }
  if (ports.length < input.count) return { ports: [], reason: 'not-enough' };
  return { ports, reason: null };
}
