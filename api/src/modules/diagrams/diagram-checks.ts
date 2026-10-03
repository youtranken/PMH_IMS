import type { IndexedCell } from './diagram-cells';
import type { CheckLink, Finding } from './diagram-finding';

/**
 * Luật DÂY của bản vẽ so với sơ đồ cổng (AD-18, Q-23 "vẽ là khai, có hỏi") — hàm THUẦN, test bảng
 * dữ liệu ở `diagram-checks.spec.ts`. MỘT bộ luật cho mọi nơi hỏi: hydrate (màu/nhãn/nét đỏ),
 * trình xem, "Có N kết nối mới chưa vẽ", tự kiểm khi gửi duyệt/phát hành và cảnh báo lệch kho.
 *
 * Chạy trên chỉ mục ô (`buildCellIndex`), không trên XML.
 */

/**
 * Trạng thái một nét dây "của kho":
 * - `linked`: mang `ims_link_id` và dòng sơ đồ cổng đó còn, nối đúng hai máy ở hai đầu nét;
 * - `removed`: mang `ims_link_id` mà dòng đó đã bị gỡ (nét đỏ);
 * - `mismatch`: dòng còn nhưng hai đầu dòng khác hai máy ở hai đầu nét (đầu nét bị kéo sang máy khác);
 * - `duplicate`: nét thứ hai trở đi mang cùng một `ims_link_id`;
 * - `undeclared`: nối hai máy kho khác nhau mà chưa khai ("Chỉ vẽ" — nét vàng).
 */
export type CableEdgeState = 'linked' | 'removed' | 'mismatch' | 'duplicate' | 'undeclared';

export interface CableEdge {
  cellId: string;
  linkId: string | null;
  state: CableEdgeState;
  sourceDeviceId: string | null;
  targetDeviceId: string | null;
}

function deviceOfCell(cells: IndexedCell[]): Map<string, IndexedCell> {
  return new Map(cells.filter((c) => c.kind === 'device' && c.deviceId).map((c) => [c.id, c]));
}

/**
 * Nét dây "của kho" theo thứ tự trong bản vẽ: mang `ims_link_id`, hoặc nối hai ô thiết bị kho
 * KHÁC máy. Nét nối hình tự do, nét lơ lửng, nét nối một máy với chính nó là đồ hoạ thuần — không
 * có mặt.
 */
export function cableEdgeStates(cells: IndexedCell[], linksById: Map<string, CheckLink>): CableEdge[] {
  const devices = deviceOfCell(cells);
  const seen = new Set<string>();
  const out: CableEdge[] = [];
  for (const cell of cells) {
    if (cell.kind !== 'edge') continue;
    const source = cell.source ? (devices.get(cell.source)?.deviceId ?? null) : null;
    const target = cell.target ? (devices.get(cell.target)?.deviceId ?? null) : null;
    const linkId = cell.ims.ims_link_id || null;
    if (linkId) {
      const link = linksById.get(linkId);
      let state: CableEdgeState;
      if (seen.has(linkId)) state = 'duplicate';
      else if (!link) state = 'removed';
      else if (!sameEnds(link, source, target)) state = 'mismatch';
      else state = 'linked';
      seen.add(linkId);
      out.push({ cellId: cell.id, linkId, state, sourceDeviceId: source, targetDeviceId: target });
    } else if (source && target && source !== target) {
      out.push({ cellId: cell.id, linkId: null, state: 'undeclared', sourceDeviceId: source, targetDeviceId: target });
    }
  }
  return out;
}

function sameEnds(link: CheckLink, a: string | null, b: string | null): boolean {
  return (link.deviceA === a && link.deviceB === b) || (link.deviceA === b && link.deviceB === a);
}

/**
 * Tự kiểm dây. Đỏ (chặn): `ims_link_id` không còn trong sơ đồ cổng, hai đầu dòng khác hai máy ở
 * hai đầu nét, hai nét cùng một dòng. Vàng (cho qua): nét giữa hai máy kho chưa khai, nét chạm máy
 * đã thanh lý (`deviceStatus` — vắng thì bỏ qua luật này).
 */
export function checkCables(
  cells: IndexedCell[],
  linksById: Map<string, CheckLink>,
  deviceStatus?: Map<string, string | null>,
): Finding[] {
  const devices = deviceOfCell(cells);
  const codeOf = (deviceId: string | null): string => {
    if (!deviceId) return '?';
    for (const cell of devices.values()) if (cell.deviceId === deviceId) return cell.ims.ims_device_code || cell.label || '?';
    return '?';
  };
  const findings: Finding[] = [];
  for (const edge of cableEdgeStates(cells, linksById)) {
    const between = `${codeOf(edge.sourceDeviceId)} ↔ ${codeOf(edge.targetDeviceId)}`;
    switch (edge.state) {
      case 'removed':
        findings.push(error('CABLE_LINK_MISSING', edge.cellId, `Dây ${between} gắn một kết nối không còn trong sơ đồ cổng.`));
        break;
      case 'mismatch':
        findings.push(error('CABLE_LINK_ENDS_MISMATCH', edge.cellId, `Dây ${between} gắn một kết nối của hai máy khác trong sơ đồ cổng.`));
        break;
      case 'duplicate':
        findings.push(error('CABLE_LINK_DUPLICATE', edge.cellId, `Dây ${between} gắn cùng một kết nối với một dây khác trên bản vẽ.`));
        break;
      case 'undeclared':
        findings.push(warning('CABLE_UNDECLARED', edge.cellId, `Dây ${between} chưa khai vào sơ đồ cổng.`));
        break;
      default:
        break;
    }
    const retired = [edge.sourceDeviceId, edge.targetDeviceId].find((id) => id && deviceStatus?.get(id) === 'retired');
    if (retired) {
      findings.push(warning('CABLE_TO_RETIRED', edge.cellId, `Dây ${between} nối tới máy đã thanh lý ${codeOf(retired)}.`));
    }
  }
  return findings;
}

function onDrawing(cells: IndexedCell[]): Set<string> {
  return new Set(cells.filter((c) => c.kind === 'device' && c.deviceId).map((c) => c.deviceId!));
}

function drawnLinkIds(cells: IndexedCell[]): Set<string> {
  return new Set(cells.filter((c) => c.kind === 'edge' && c.ims.ims_link_id).map((c) => c.ims.ims_link_id));
}

/** Kết nối giữa hai máy CÙNG có trên bản vẽ mà chưa nét nào mang id của nó — "Có N kết nối mới chưa vẽ". */
export function undrawnLinks<T extends CheckLink>(cells: IndexedCell[], links: T[]): T[] {
  const present = onDrawing(cells);
  const drawn = drawnLinkIds(cells);
  return links.filter((l) => present.has(l.deviceA) && present.has(l.deviceB) && !drawn.has(l.id));
}

/** Kết nối có ĐÚNG một đầu trên bản vẽ — trình xem chỉ "→ máy kia (bản vẽ khác)". */
export function externalLinks<T extends CheckLink>(cells: IndexedCell[], links: T[]): T[] {
  const present = onDrawing(cells);
  return links.filter((l) => present.has(l.deviceA) !== present.has(l.deviceB));
}

function error(code: string, cellId: string, message: string): Finding {
  return { level: 'error', code, cellId, message };
}

function warning(code: string, cellId: string, message: string): Finding {
  return { level: 'warning', code, cellId, message };
}
