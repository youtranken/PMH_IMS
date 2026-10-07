/**
 * Chỗ đặt nhãn cổng ở hai đầu dây (Q-26 07/10) — hàm THUẦN, test bảng ở `port-end-place.spec.ts`.
 *
 * draw.io đặt nhãn con của nét theo vị trí TƯƠNG ĐỐI dọc nét (−1 đầu nguồn … 1 đầu đích), nên một hệ
 * số cố định đẩy nhãn ra xa máy khi dây đi vòng dài. Ở đây đổi khoảng cách mong muốn (px) ra vị trí
 * tương đối theo độ dài đường dây đo từ hình. PHẢI cùng phép với `portEndOffset` bên web
 * (`web/src/features/diagrams/cable-ends.ts`) — nhãn chèn lúc khai dây và nhãn dựng lúc mở là một.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgePath {
  /** Khung tuyệt đối của ô hai đầu; `null` = đầu đó không nối vào ô nào. */
  source: Box | null;
  target: Box | null;
  /** Điểm gấp (toạ độ tuyệt đối). */
  points: { x: number; y: number }[];
  /** Nét kiểu vuông góc: mỗi đoạn giữa hai điểm đi theo trục, dài |dx| + |dy|. */
  orthogonal: boolean;
}

/** Khoảng cách từ mép máy tới tâm nhãn. */
export const PORT_END_GAP = 22;
/** Chỗ cũ khi không đo được nét. */
export const PORT_END_FALLBACK = 0.75;
/** Dây quá ngắn: hai nhãn không được trượt vào giữa nét quá mức này. */
const MIN_OFFSET = 0.3;

const center = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** Đoạn từ tâm máy tới mép theo hướng đi ra (vuông góc: theo trục trội). */
function exitDistance(box: Box, from: { x: number; y: number }, to: { x: number; y: number }, orthogonal: boolean): number {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (orthogonal) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  const length = Math.hypot(dx, dy);
  if (length === 0) return 0;
  const ux = Math.abs(dx) / length;
  const uy = Math.abs(dy) / length;
  const along = Math.min(ux > 0 ? box.width / 2 / ux : Infinity, uy > 0 ? box.height / 2 / uy : Infinity);
  return Number.isFinite(along) ? along : 0;
}

/** Vị trí tương đối (0 … 1) của hai nhãn: nguồn đặt ở −giá trị, đích ở +giá trị. */
export function portEndOffset(path: EdgePath): number {
  if (!path.source || !path.target) return PORT_END_FALLBACK;
  const line = [center(path.source), ...path.points, center(path.target)];
  let total = 0;
  for (let i = 1; i < line.length; i += 1) {
    const dx = Math.abs(line[i].x - line[i - 1].x);
    const dy = Math.abs(line[i].y - line[i - 1].y);
    total += path.orthogonal ? dx + dy : Math.hypot(dx, dy);
  }
  const visible =
    total -
    exitDistance(path.source, line[0], line[1], path.orthogonal) -
    exitDistance(path.target, line[line.length - 1], line[line.length - 2], path.orthogonal);
  if (visible <= 0) return MIN_OFFSET;
  return Math.max(MIN_OFFSET, Math.round((1 - (2 * PORT_END_GAP) / visible) * 1000) / 1000);
}
