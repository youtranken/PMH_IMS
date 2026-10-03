import { createHash } from 'node:crypto';
import { SaxesParser, type SaxesTagPlain } from 'saxes';
import { textLooksLikeSecret } from '../../common/note-secret';

/**
 * Chỉ mục ô của một phiên bản bản vẽ (AD-18) — hàm THUẦN, test bảng dữ liệu ở
 * `diagram-cells.spec.ts`.
 *
 * Tóm tắt một dòng, so sánh hai phiên bản, tự kiểm và phát hiện lệch kho đều chạy trên chỉ mục
 * này chứ không trên XML: XML chỉ parse một lần lúc lưu, các phép so về sau đọc JSON đã lưu.
 *
 * Chỉ gọi SAU cổng kiểm (`diagram-gate.ts`): hàm này tin rằng XML đúng một trang, không nén.
 */

export type CellKind = 'device' | 'edge' | 'shape';

export interface CellBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IndexedCell {
  id: string;
  kind: CellKind;
  parent: string | null;
  /** Lớp chứa ô (ô con của nhóm vẫn thuộc lớp chứa nhóm). */
  layer: string | null;
  source?: string;
  target?: string;
  deviceId?: string;
  /** Mọi thuộc tính `ims_*` của ô — hợp đồng gắn dữ liệu (AD-18). */
  ims: Record<string, string>;
  /** Chữ thuần người xem thấy (nhãn HTML đã bỏ thẻ). */
  label: string;
  bounds?: CellBounds;
  /** Dấu vân tay đồ hoạ + dữ liệu: khác nhau = ô bị đổi giữa hai phiên bản. */
  fp: string;
}

export interface CellIndex {
  layers: string[];
  cells: IndexedCell[];
}

export interface DiffItem {
  id: string;
  label: string;
}

export interface GroupDiff {
  added: DiffItem[];
  removed: DiffItem[];
  changed: DiffItem[];
}

export interface CellDiff {
  devices: GroupDiff;
  edges: GroupDiff;
  shapes: GroupDiff;
}

interface RawCell {
  id: string;
  attrs: Record<string, string>;
  data: Record<string, string> | null;
  geometry: Record<string, string> | null;
  points: string[];
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED[body.toLowerCase()] ?? match;
  });
}

/** Nhãn draw.io → chữ thuần: nhãn HTML bỏ thẻ (thẻ xuống dòng thành khoảng trắng). */
function plainLabel(value: string, html: boolean): string {
  const text = html ? decodeEntities(value.replace(/<[^>]*>/g, ' ')) : value;
  return text.replace(/\s+/g, ' ').trim();
}

function number(value: string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fingerprint(parts: unknown): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

function imsAttrs(...sources: (Record<string, string> | null)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) if (key.startsWith('ims_')) out[key] = value;
  }
  return out;
}

function readRawCells(xml: string): RawCell[] {
  const cells: RawCell[] = [];
  const parser = new SaxesParser({ xmlns: false });
  const stack: string[] = [];
  let data: { id: string; attrs: Record<string, string> } | null = null;
  let current: RawCell | null = null;

  parser.on('opentag', (tag: SaxesTagPlain) => {
    const attrs = tag.attributes as Record<string, string>;
    if (tag.name === 'UserObject' || tag.name === 'object') {
      data = { id: attrs.id ?? '', attrs };
    } else if (tag.name === 'mxCell') {
      current = {
        id: attrs.id ?? data?.id ?? '',
        attrs,
        data: data?.attrs ?? null,
        geometry: null,
        points: [],
      };
    } else if (current && tag.name === 'mxGeometry' && stack[stack.length - 1] === 'mxCell') {
      current.geometry = attrs;
    } else if (current && tag.name === 'mxPoint') {
      current.points.push(`${attrs.as ?? ''}:${attrs.x ?? 0},${attrs.y ?? 0}`);
    }
    if (!tag.isSelfClosing) stack.push(tag.name);
    if (tag.isSelfClosing && tag.name === 'mxCell') {
      cells.push(current!);
      current = null;
    }
  });
  parser.on('closetag', (tag: SaxesTagPlain) => {
    if (tag.isSelfClosing) return;
    stack.pop();
    if (tag.name === 'mxCell' && current) {
      cells.push(current);
      current = null;
    } else if (tag.name === 'UserObject' || tag.name === 'object') {
      data = null;
    }
  });
  parser.write(xml).close();
  return cells;
}

/** XML (đã qua cổng) → chỉ mục ô. Ô gốc và ô lớp không vào `cells`, lớp nằm ở `layers`. */
export function buildCellIndex(xml: string): CellIndex {
  const raw = readRawCells(xml);
  const parentOf = new Map(raw.map((c) => [c.id, c.attrs.parent ?? null]));
  const rootIds = new Set(raw.filter((c) => !c.attrs.parent).map((c) => c.id));
  const layers = raw.filter((c) => c.attrs.parent && rootIds.has(c.attrs.parent)).map((c) => c.id);
  const layerSet = new Set(layers);

  const layerOf = (id: string): string | null => {
    const seen = new Set<string>();
    let at: string | null = parentOf.get(id) ?? null;
    while (at && !layerSet.has(at) && !seen.has(at)) {
      seen.add(at);
      at = parentOf.get(at) ?? null;
    }
    return at && layerSet.has(at) ? at : null;
  };

  const cells: IndexedCell[] = [];
  for (const cell of raw) {
    if (rootIds.has(cell.id) || layerSet.has(cell.id)) continue;
    const ims = imsAttrs(cell.data);
    const isEdge = cell.attrs.edge === '1';
    const kind: CellKind = isEdge ? 'edge' : ims.ims_device_id ? 'device' : 'shape';
    const style = cell.attrs.style ?? '';
    const rawLabel = cell.data ? (cell.data.label ?? '') : (cell.attrs.value ?? '');
    const geometry = cell.geometry;
    const entry: IndexedCell = {
      id: cell.id,
      kind,
      parent: cell.attrs.parent ?? null,
      layer: layerOf(cell.id),
      ims,
      label: plainLabel(rawLabel, /(?:^|;)html=1/.test(style)),
      fp: fingerprint([kind, cell.attrs, cell.data, geometry, cell.points]),
    };
    if (isEdge) {
      if (cell.attrs.source) entry.source = cell.attrs.source;
      if (cell.attrs.target) entry.target = cell.attrs.target;
    }
    if (ims.ims_device_id) entry.deviceId = ims.ims_device_id;
    if (geometry && geometry.relative !== '1') {
      entry.bounds = { x: number(geometry.x), y: number(geometry.y), width: number(geometry.width), height: number(geometry.height) };
    }
    cells.push(entry);
  }
  return { layers, cells };
}

function itemOf(cell: IndexedCell): DiffItem {
  return { id: cell.id, label: cell.ims.ims_device_code || cell.label || cell.id };
}

function emptyGroup(): GroupDiff {
  return { added: [], removed: [], changed: [] };
}

const GROUP_OF: Record<CellKind, keyof CellDiff> = { device: 'devices', edge: 'edges', shape: 'shapes' };

/**
 * Hai phiên bản → thêm/bỏ/đổi theo nhóm. Ô đổi loại (hình thường → ô thiết bị) là bỏ ở nhóm
 * cũ + thêm ở nhóm mới: người đọc tóm tắt hỏi "bản vẽ có thêm máy nào không", không hỏi id ô.
 */
export function diffCellIndex(prev: CellIndex | null, next: CellIndex): CellDiff {
  const diff: CellDiff = { devices: emptyGroup(), edges: emptyGroup(), shapes: emptyGroup() };
  const before = new Map((prev?.cells ?? []).map((c) => [c.id, c]));
  const after = new Map(next.cells.map((c) => [c.id, c]));
  for (const cell of next.cells) {
    const old = before.get(cell.id);
    if (!old || old.kind !== cell.kind) diff[GROUP_OF[cell.kind]].added.push(itemOf(cell));
    else if (old.fp !== cell.fp) diff[GROUP_OF[cell.kind]].changed.push(itemOf(cell));
  }
  for (const cell of prev?.cells ?? []) {
    const now = after.get(cell.id);
    if (!now || now.kind !== cell.kind) diff[GROUP_OF[cell.kind]].removed.push(itemOf(cell));
  }
  return diff;
}

/** "Thêm 3 thiết bị, bỏ 1 thiết bị, đổi 37 dây, 5 hình tự do" — câu tóm tắt một dòng. */
export function summarizeDiff(diff: CellDiff): string {
  const parts: string[] = [];
  const counted = (group: GroupDiff, noun: string) => {
    if (group.added.length) parts.push(`thêm ${group.added.length} ${noun}`);
    if (group.removed.length) parts.push(`bỏ ${group.removed.length} ${noun}`);
    if (group.changed.length) parts.push(`đổi ${group.changed.length} ${noun}`);
  };
  counted(diff.devices, 'thiết bị');
  counted(diff.edges, 'dây');
  const shapes = diff.shapes.added.length + diff.shapes.removed.length + diff.shapes.changed.length;
  if (shapes) parts.push(`${shapes} hình tự do`);
  if (parts.length === 0) return 'Không đổi gì';
  const line = parts.join(', ');
  return line[0].toUpperCase() + line.slice(1);
}

/**
 * Chữ trên một hình trông như mật khẩu (Q-19, SEC-21): bản vẽ không mã hoá, đi vào lịch sử
 * phiên bản không xoá được và ảnh xuất — mật khẩu ghi lên hình là đi vòng qua két. Câu lỗi chỉ
 * nêu id ô, không nhắc lại chữ.
 */
export function secretLabelReason(index: CellIndex): string | null {
  const hit = index.cells.find((cell) => textLooksLikeSecret(cell.label));
  if (!hit) return null;
  return `Một hình trên bản vẽ (ô ${hit.id}) có chữ trông như mật khẩu — mật khẩu cất trong két, không ghi lên bản vẽ.`;
}
