import { paintImsStyle } from '@/ui/drawio-protocol';
import { cellIdOf, parseDrawioXml } from './drawio-bridge';

/**
 * Nhãn cổng ở HAI ĐẦU dây của kho (Q-23) — hàm THUẦN, test bảng ở `cable-ends.test.ts`.
 *
 * Nét mang cờ `ims_port_labels="ends"` (lưu trong XML khô) có hai ô nhãn con, id cố định theo nét
 * (`<nét>-ims-ps` ở đầu nguồn, `<nét>-ims-pt` ở đầu đích). Server dựng chúng mỗi lần mở và gỡ mỗi lần
 * lưu (`diagram-hydrate.ts`); web chỉ chèn / sửa / gỡ chúng khi CHÍNH nó đổi nét trong lúc vẽ (Khai,
 * Vẽ vào, Tự đi lại dây, bỏ kết nối), để người vẽ thấy ngay mà không phải lưu rồi mở lại.
 */

export const PORT_LABELS_ATTR = 'ims_port_labels';
export const PORT_LABELS_ENDS = 'ends';

const SUFFIX = { source: '-ims-ps', target: '-ims-pt' } as const;
/** Dấu style server đặt cho ô nhãn đầu dây (`portEndStyle` của `diagram-hydrate.ts`). */
const PORT_END_MARK = 'imsPortEnd=1';

/** Style + chỗ đặt do server dựng theo loại dây (`DiagramLink.endLabel`). */
export interface EndLabelSpec {
  style: string;
  offset: number;
}

/** Cổng ở đầu nguồn / đầu đích của nét. Nét vẽ từ máy đầu kia (`peerDeviceId`) thì đọc ngược. */
export function linkEndTexts(
  link: { deviceId: string; portLabel: string; peerDeviceId: string; peerPort: string | null },
  sourceDeviceId: string | null,
): { source: string; target: string } {
  const a = link.portLabel;
  const b = link.peerPort ?? '—';
  return sourceDeviceId === link.peerDeviceId ? { source: b, target: a } : { source: a, target: b };
}

/** Id hai ô nhãn đầu của một nét (cố định theo nét) — trình xem coi chúng là chính nét dây. */
export function portEndIds(edgeId: string): string[] {
  return [edgeId + SUFFIX.source, edgeId + SUFFIX.target];
}

/** Mọi id ô trong XML (`<mxCell>` trần và phần tử bọc) — đọc một lần cho cả lô dây. */
export function cellIdsIn(xml: string): Set<string> {
  const found = new Set<string>();
  const doc = parseDrawioXml(xml);
  if (!doc) return found;
  for (const tag of ['mxCell', 'UserObject', 'object']) {
    for (const el of Array.from(doc.getElementsByTagName(tag))) {
      const id = el.getAttribute('id');
      if (id) found.add(id);
    }
  }
  return found;
}

function geometry(x: number): string {
  return `<mxGeometry x="${x}" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry>`;
}

/**
 * Mục `i` / `u` của lệnh `patch` cho hai nhãn đầu của một nét. Ô đã có thì SỬA (không gỡ rồi chèn:
 * draw.io chèn trước, gỡ sau trong cùng một lệnh — gỡ cùng id là gỡ luôn ô vừa chèn).
 */
export function portEndPatch(
  /** XML cả tệp, hoặc `cellIdsIn(xml)` đã đọc sẵn khi gọi trong vòng lặp theo dây. */
  xml: string | ReadonlySet<string>,
  edgeId: string,
  texts: { source: string; target: string },
  spec: EndLabelSpec,
  palette: Record<string, string>,
): { i: object[]; u: Record<string, Record<string, string>> } {
  const style = paintImsStyle(spec.style, palette);
  const ids = { source: edgeId + SUFFIX.source, target: edgeId + SUFFIX.target };
  const present = typeof xml === 'string' ? cellIdsIn(xml) : xml;
  const out: { i: object[]; u: Record<string, Record<string, string>> } = { i: [], u: {} };
  for (const side of ['source', 'target'] as const) {
    const at = geometry(side === 'source' ? -spec.offset : spec.offset);
    if (present.has(ids[side])) {
      out.u[ids[side]] = { value: texts[side], style, geometry: at };
    } else {
      out.i.push({ id: ids[side], vertex: 1, connectable: 0, parent: edgeId, value: texts[side], style, geometry: at });
    }
  }
  return out;
}

/**
 * Nhãn đầu dây đang là con của nét — mục `r` khi nét thôi mang kết nối. Tìm theo cha + dấu style chứ
 * không chỉ theo id: nét nhân bản / dán mang theo bản sao nhãn với id mới do draw.io đặt.
 */
export function portEndRemoval(xml: string, edgeId: string): string[] {
  const doc = parseDrawioXml(xml);
  if (!doc) return [];
  const out: string[] = [];
  for (const cell of Array.from(doc.getElementsByTagName('mxCell'))) {
    if (cell.getAttribute('parent') !== edgeId) continue;
    const id = cellIdOf(cell);
    const marked = (cell.getAttribute('style') ?? '').split(';').includes(PORT_END_MARK);
    if (id && (marked || id === edgeId + SUFFIX.source || id === edgeId + SUFFIX.target)) out.push(id);
  }
  return out;
}
