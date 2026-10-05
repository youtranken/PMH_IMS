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

/**
 * Khoá đối tượng xếp theo bảng chữ trước khi băm: draw.io xuất lại thuộc tính XML theo thứ tự riêng
 * của nó, nên cùng một ô mà băm theo thứ tự đọc được sẽ thành "đổi" dù không ai sửa gì.
 */
function fingerprint(parts: unknown): string {
  return createHash('sha1').update(JSON.stringify(parts, sortedKeys)).digest('hex').slice(0, 16);
}

function sortedKeys(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
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

/**
 * Lớp draw.io và tên của nó, theo thứ tự trong XML — trình xem bật/tắt lớp. Tên
 * không nằm trong chỉ mục ô đã lưu, nên đọc lại từ XML lúc mở; cùng định nghĩa "lớp" với
 * `buildCellIndex` (ô có cha là ô gốc). Lớp mặc định không tên trả `name: ''`, web tự đặt nhãn.
 */
export function layerNames(xml: string): { id: string; name: string }[] {
  const raw = readRawCells(xml);
  const rootIds = new Set(raw.filter((c) => !c.attrs.parent).map((c) => c.id));
  return raw
    .filter((c) => c.attrs.parent && rootIds.has(c.attrs.parent))
    .map((c) => ({
      id: c.id,
      name: plainLabel(c.data ? (c.data.label ?? '') : (c.attrs.value ?? ''), /(?:^|;)html=1/.test(c.attrs.style ?? '')),
    }));
}

/**
 * Tên người đọc được của ô `id` trong một phiên bản: mã máy, không thì nhãn; dây không nhãn thì
 * "đầu ↔ đầu" theo tên hai ô nó nối. `label: null` khi vẫn không có chữ — nơi hiện tự gọi theo
 * `kind` ("hình không tên"); `kind: null` khi phiên bản không có ô đó (hình đã bỏ). Không bao giờ
 * trả id kỹ thuật: người duyệt không đọc được nó.
 */
export function cellCaption(index: CellIndex, id: string): { kind: CellKind | null; label: string | null } {
  return cellCaptioner(index)(id);
}

/**
 * Bộ tra `cellCaption` dựng MỘT lần cho cả phiên bản: tên mọi ô tính chung một lượt, nên đọc
 * nhiều ghim trên cùng phiên bản không quét lại cả bản vẽ cho từng ghim.
 */
export function cellCaptioner(index: CellIndex): (id: string) => { kind: CellKind | null; label: string | null } {
  const byId = new Map(index.cells.map((c) => [c.id, c]));
  const labels = cellLabels(index);
  return (id) => {
    const cell = byId.get(id);
    return cell ? { kind: cell.kind, label: labels.get(cell.id) ?? null } : { kind: null, label: null };
  };
}

/** Tên của mọi ô có chữ trong phiên bản (luật như `cellCaption`), một lượt cho cả bản vẽ. */
export function cellLabels(index: CellIndex): Map<string, string> {
  const own = new Map<string, string>();
  for (const cell of index.cells) {
    const text = cell.ims.ims_device_code || cell.label;
    if (text) own.set(cell.id, text);
  }
  const out = new Map(own);
  for (const cell of index.cells) {
    if (cell.kind !== 'edge' || own.has(cell.id)) continue;
    const a = cell.source ? own.get(cell.source) : undefined;
    const b = cell.target ? own.get(cell.target) : undefined;
    if (a && b) out.set(cell.id, `${a} ↔ ${b}`);
  }
  return out;
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
 *
 * Thiết bị đếm theo `ims_device_id`, không theo id ô: xoá ô rồi chèn lại đúng máy đó, hay nhân
 * bản ô của một máy đã có, không phải "thêm một thiết bị" — kho vẫn chừng ấy máy trên bản vẽ.
 * Máy còn đó mà ô của nó đổi (dời, đổi cỡ, thay ô) là "đổi".
 *
 * Dây đã khai đếm theo `ims_link_id` cùng lý do: vẽ lại nét của đúng kết nối đó là "đổi 1 dây".
 * Nét chưa khai đếm theo id ô; nét vừa được gắn kết nối (cùng id ô) vẫn là một dây.
 */
export function diffCellIndex(prev: CellIndex | null, next: CellIndex): CellDiff {
  const diff: CellDiff = { devices: emptyGroup(), edges: emptyGroup(), shapes: emptyGroup() };
  const before = new Map((prev?.cells ?? []).map((c) => [c.id, c]));
  const after = new Map(next.cells.map((c) => [c.id, c]));
  for (const cell of next.cells) {
    if (cell.kind === 'device' || isLinkedEdge(cell)) continue;
    const old = before.get(cell.id);
    if (!old || old.kind !== cell.kind) diff[GROUP_OF[cell.kind]].added.push(itemOf(cell));
    else if (old.fp !== cell.fp) diff[GROUP_OF[cell.kind]].changed.push(itemOf(cell));
  }
  for (const cell of prev?.cells ?? []) {
    if (cell.kind === 'device' || isLinkedEdge(cell)) continue;
    const now = after.get(cell.id);
    if (!now || now.kind !== cell.kind) diff[GROUP_OF[cell.kind]].removed.push(itemOf(cell));
  }
  const devicesBefore = byDevice(prev?.cells ?? []);
  const devicesAfter = byDevice(next.cells);
  for (const [deviceId, cells] of devicesAfter) {
    const old = devicesBefore.get(deviceId);
    if (!old) diff.devices.added.push(deviceItem(deviceId, cells));
    else if (cellsPrint(old) !== cellsPrint(cells)) diff.devices.changed.push(deviceItem(deviceId, cells));
  }
  for (const [deviceId, cells] of devicesBefore) {
    if (!devicesAfter.has(deviceId)) diff.devices.removed.push(deviceItem(deviceId, cells));
  }
  diffLinkedEdges(prev?.cells ?? [], next.cells, before, after, diff.edges);
  return diff;
}

function isLinkedEdge(cell: IndexedCell): boolean {
  return cell.kind === 'edge' && Boolean(cell.ims.ims_link_id);
}

/**
 * Nét đã khai, gom theo `ims_link_id`. Một nét đổi giữa "chưa khai" và "đã khai" mà giữ id ô là
 * MỘT dây đổi trạng thái, không phải bỏ một thêm một — nên nhóm nào có ô từng là nét chưa khai ở
 * phía bên kia thì tính "đổi" (và nét chưa khai đó đã được vòng trên tính rồi thì bỏ qua ở đây).
 */
function diffLinkedEdges(
  prevCells: IndexedCell[],
  nextCells: IndexedCell[],
  before: Map<string, IndexedCell>,
  after: Map<string, IndexedCell>,
  group: GroupDiff,
): void {
  const byLink = (cells: IndexedCell[]) => {
    const out = new Map<string, IndexedCell[]>();
    for (const cell of cells) {
      if (!isLinkedEdge(cell)) continue;
      out.set(cell.ims.ims_link_id, [...(out.get(cell.ims.ims_link_id) ?? []), cell]);
    }
    return out;
  };
  const linksBefore = byLink(prevCells);
  const linksAfter = byLink(nextCells);
  const unlinkedCounterpart = (cells: IndexedCell[], other: Map<string, IndexedCell>) =>
    cells.some((c) => {
      const twin = other.get(c.id);
      return twin !== undefined && twin.kind === 'edge' && !isLinkedEdge(twin);
    });
  for (const [linkId, cells] of linksAfter) {
    const old = linksBefore.get(linkId);
    if (old) {
      if (cellsPrint(old) !== cellsPrint(cells)) group.changed.push(linkItem(linkId, cells));
    } else if (unlinkedCounterpart(cells, before)) {
      // Nét chưa khai ở bản trước vừa được gắn kết nối: vòng trên đã đếm "đổi" theo id ô.
      if (!group.changed.some((item) => cells.some((c) => c.id === item.id))) group.changed.push(linkItem(linkId, cells));
    } else {
      group.added.push(linkItem(linkId, cells));
    }
  }
  for (const [linkId, cells] of linksBefore) {
    if (linksAfter.has(linkId)) continue;
    if (unlinkedCounterpart(cells, after)) {
      if (!group.changed.some((item) => cells.some((c) => c.id === item.id))) group.changed.push(linkItem(linkId, cells));
    } else {
      group.removed.push(linkItem(linkId, cells));
    }
  }
}

function linkItem(linkId: string, cells: IndexedCell[]): DiffItem {
  return { id: linkId, label: cells[0].label || linkId };
}

function byDevice(cells: IndexedCell[]): Map<string, IndexedCell[]> {
  const out = new Map<string, IndexedCell[]>();
  for (const cell of cells) {
    if (cell.kind !== 'device' || !cell.deviceId) continue;
    out.set(cell.deviceId, [...(out.get(cell.deviceId) ?? []), cell]);
  }
  return out;
}

/** Dấu vân tay mọi ô của một máy, kèm id ô (thay ô cũng là đổi). */
function cellsPrint(cells: IndexedCell[]): string {
  return cells
    .map((c) => `${c.id}:${c.fp}`)
    .sort()
    .join('|');
}

function deviceItem(deviceId: string, cells: IndexedCell[]): DiffItem {
  return { id: deviceId, label: cells[0].ims.ims_device_code || cells[0].label || deviceId };
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
  // Viết hoa CHỮ CÁI đầu, không phải ký tự đầu: câu mở bằng số ("1 hình tự do") thì danh từ sau
  // số mới là chữ đầu cụm (Q-24).
  return line.replace(/\p{L}/u, (ch) => ch.toUpperCase());
}

const OVERWRITE_PREFIX = 'lưu đè lên bản của ';

/** Đuôi tóm tắt khi một người lưu đè lên bản người khác vừa lưu — ghi vào `summary` lúc lưu. */
export function overwriteNote(name: string): string {
  return `${OVERWRITE_PREFIX}${name}`;
}

/**
 * Tách đuôi "lưu đè lên bản của …" khỏi tóm tắt (nó luôn là cụm CUỐI) để panel hiện tiêu đề gọn
 * và nhãn nhỏ riêng. Server tách vì server ghép chữ đó; tóm tắt cũ không có đuôi thì để nguyên.
 */
export function splitSummary(summary: string): { brief: string; overwrote: string | null } {
  const at = summary.lastIndexOf(` · ${OVERWRITE_PREFIX}`);
  if (at < 0) return { brief: summary, overwrote: null };
  return { brief: summary.slice(0, at), overwrote: summary.slice(at + 3 + OVERWRITE_PREFIX.length) };
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
