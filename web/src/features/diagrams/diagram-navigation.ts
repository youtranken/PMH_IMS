import { foldSearch } from '@/lib/search-fold';
import type { ViewerLayer } from '@/ui/diagram-viewer';
import type { DiagramContent, DiagramRef, PathResult } from './diagram-api';

/**
 * Tìm, lớp, chỉ đường trên trình xem — hàm thuần, test bảng dữ liệu ở `diagram-navigation.test.ts`.
 * Mọi thứ dựa trên chỉ mục ô + dữ liệu kho server trả kèm nội dung (AD-18), không đọc DOM SVG.
 */

export interface LayerLabels {
  /** Lớp mặc định của draw.io không có tên. */
  baseLayer: string;
  noDeviceType: string;
  noCableType: string;
}

const byLabel = (a: ViewerLayer, b: ViewerLayer) => a.label.localeCompare(b.label, 'vi');

/**
 * Lớp bật/tắt: lớp draw.io (chỉ khi bản vẽ có từ hai lớp trở lên — một lớp thì tắt là trắng
 * trang), nhóm theo loại thiết bị, nhóm theo loại dây của dòng sơ đồ cổng mà nét mang.
 */
export function buildLayers(content: DiagramContent, labels: LayerLabels): ViewerLayer[] {
  const out: ViewerLayer[] = [];
  const drawio = content.layers ?? [];
  if (drawio.length > 1) {
    for (const layer of drawio) {
      out.push({
        key: `drawio:${layer.id}`,
        label: layer.name || labels.baseLayer,
        group: 'drawio',
        cellIds: (content.cells ?? []).filter((cell) => cell.layer === layer.id).map((cell) => cell.id),
      });
    }
  }

  const typeOf = new Map((content.devices ?? []).map((d) => [d.id, d.deviceTypeName ?? '']));
  const types = new Map<string, string[]>();
  for (const cell of content.deviceCells ?? []) {
    const type = typeOf.get(cell.deviceId) ?? '';
    types.set(type, [...(types.get(type) ?? []), cell.cellId]);
  }
  out.push(
    ...[...types]
      .map(([type, cellIds]): ViewerLayer => ({ key: `type:${type}`, label: type || labels.noDeviceType, group: 'deviceType', cellIds }))
      .sort(byLabel),
  );

  const cableOf = new Map((content.links ?? []).map((l) => [l.id, l.cableTypeId ?? '']));
  const cableName = new Map((content.cableTypes ?? []).map((c) => [c.id, c.name]));
  const cables = new Map<string, string[]>();
  for (const edge of content.cableEdges ?? []) {
    const type = (edge.linkId && cableOf.get(edge.linkId)) || '';
    cables.set(type, [...(cables.get(type) ?? []), edge.cellId]);
  }
  out.push(
    ...[...cables]
      .map(([type, cellIds]): ViewerLayer => ({ key: `cable:${type}`, label: (type && cableName.get(type)) || labels.noCableType, group: 'cableType', cellIds }))
      .sort(byLabel),
  );
  return out;
}

export interface DrawingMatch {
  deviceId: string;
  cellId: string;
  code: string;
  name: string | null;
}

/** Máy trên bản vẽ đang xem khớp mã / tên / IP (bỏ dấu, không phân biệt hoa thường). */
export function matchOnDrawing(content: DiagramContent, query: string): DrawingMatch[] {
  const q = foldSearch(query.trim());
  if (!q) return [];
  const devices = new Map((content.devices ?? []).map((d) => [d.id, d]));
  const seen = new Set<string>();
  const out: DrawingMatch[] = [];
  for (const cell of content.deviceCells ?? []) {
    if (seen.has(cell.deviceId)) continue;
    const device = devices.get(cell.deviceId);
    const code = device?.code ?? cell.code;
    const haystack = [code, device?.name ?? '', ...(device?.ips ?? [])].map(foldSearch);
    if (!haystack.some((text) => text.includes(q))) continue;
    seen.add(cell.deviceId);
    out.push({ deviceId: cell.deviceId, cellId: cell.cellId, code, name: device?.name ?? null });
  }
  return out;
}

export interface PathView {
  /** Ô sáng trên bản vẽ đang xem: ô máy trên đường + nét dây giữa hai máy kề nhau trên đường. */
  cellIds: string[];
  /** Máy trên đường KHÔNG có ở bản vẽ này — mũi tên "→ máy (bản vẽ khác)". */
  elsewhere: { deviceId: string; code: string; diagrams: DiagramRef[] }[];
}

/**
 * Đường từ server (sơ đồ cổng) → phần nằm trên bản vẽ đang xem. Nét sáng khi mang đúng dây của
 * đường, HOẶC nối hai máy kề nhau trên đường (nét chưa khai / gắn dây song song vẫn là đoạn đó).
 */
export function pathOnDrawing(content: DiagramContent, result: PathResult, currentDiagramId: string): PathView {
  if (!result.path) return { cellIds: [], elsewhere: [] };
  const { hops, linkIds } = result.path;
  const cellsOf = new Map<string, string[]>();
  for (const cell of content.deviceCells ?? []) cellsOf.set(cell.deviceId, [...(cellsOf.get(cell.deviceId) ?? []), cell.cellId]);
  const onPath = new Set(linkIds);
  const pairs = new Set<string>();
  for (let i = 0; i + 1 < hops.length; i += 1) {
    pairs.add(`${hops[i].deviceId}|${hops[i + 1].deviceId}`);
    pairs.add(`${hops[i + 1].deviceId}|${hops[i].deviceId}`);
  }
  const cellIds = hops.flatMap((hop) => cellsOf.get(hop.deviceId) ?? []);
  for (const edge of content.cableEdges ?? []) {
    if ((edge.linkId && onPath.has(edge.linkId)) || pairs.has(`${edge.sourceDeviceId}|${edge.targetDeviceId}`)) cellIds.push(edge.cellId);
  }
  const elsewhere = hops
    .filter((hop) => !cellsOf.has(hop.deviceId))
    .map((hop) => ({ deviceId: hop.deviceId, code: hop.code, diagrams: hop.diagrams.filter((d) => d.id !== currentDiagramId) }));
  return { cellIds, elsewhere };
}
