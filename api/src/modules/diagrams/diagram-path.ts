/**
 * "Chỉ đường" giữa hai máy (FR-047, AD-18) — hàm THUẦN, test bảng dữ liệu ở `diagram-path.spec.ts`.
 *
 * Đồ thị là sơ đồ cổng chứ không phải nét vẽ: nét draw.io có thể thiếu, thừa hay nối sai, còn câu
 * hỏi lúc sự cố là "dây thật đi qua những máy nào". Mỗi dòng `device_port` là một cạnh vô hướng.
 */

export interface PathEdge {
  /** Id dòng sơ đồ cổng (= `ims_link_id` trên nét vẽ). */
  id: string;
  a: string;
  b: string;
}

export interface PortPath {
  /** Máy theo thứ tự đi, kể cả hai đầu. */
  devices: string[];
  /** Dây nối máy thứ i với máy thứ i+1. */
  links: string[];
}

/**
 * Đường ít dây nhất từ `from` tới `to` (BFS), tối đa `maxHops` dây; không có thì `null`.
 *
 * Láng giềng duyệt theo id dây tăng dần, nên hai đường dài bằng nhau luôn ra cùng một kết quả —
 * hai người trực cùng hỏi một cặp máy phải thấy cùng một đường.
 */
export function shortestPortPath(from: string, to: string, edges: PathEdge[], maxHops: number): PortPath | null {
  if (from === to) return { devices: [from], links: [] };
  const adjacent = new Map<string, { link: string; peer: string }[]>();
  for (const edge of [...edges].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    if (edge.a === edge.b) continue;
    adjacent.set(edge.a, [...(adjacent.get(edge.a) ?? []), { link: edge.id, peer: edge.b }]);
    adjacent.set(edge.b, [...(adjacent.get(edge.b) ?? []), { link: edge.id, peer: edge.a }]);
  }
  const via = new Map<string, { link: string; prev: string }>();
  const seen = new Set([from]);
  let frontier = [from];
  for (let hop = 0; hop < maxHops && frontier.length > 0; hop += 1) {
    const next: string[] = [];
    for (const at of frontier) {
      for (const { link, peer } of adjacent.get(at) ?? []) {
        if (seen.has(peer)) continue;
        seen.add(peer);
        via.set(peer, { link, prev: at });
        if (peer === to) return walkBack(from, to, via);
        next.push(peer);
      }
    }
    frontier = next;
  }
  return null;
}

function walkBack(from: string, to: string, via: Map<string, { link: string; prev: string }>): PortPath {
  const devices = [to];
  const links: string[] = [];
  for (let at = to; at !== from; ) {
    const step = via.get(at)!;
    links.unshift(step.link);
    devices.unshift(step.prev);
    at = step.prev;
  }
  return { devices, links };
}
