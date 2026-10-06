import { rackUnitLabel } from '@/lib/rack-units';
import type { DrawioSelected } from '@/ui/drawio-protocol';
import { portEndIds } from './cable-ends';
import type { CableEdge, CableTypeInfo, DiagramContent, DiagramDeviceInfo, DiagramLink } from './diagram-api';

/**
 * Thẻ thông tin khi rê chuột (tab Xem) hoặc khi chọn ô (tab Sửa) — Q-23. Hàm THUẦN, test bảng
 * ở `diagram-hover.test.ts`; chữ nhãn của từng dòng do component dịch theo `key`.
 */

export type HoverRowKey = 'ip' | 'model' | 'location' | 'ports' | 'status' | 'cableType' | 'state';

export interface HoverCardData {
  kind: 'device' | 'cable';
  /** Mã máy, hay "A máy:cổng ↔ B máy:cổng"; `null` = nét chưa gắn kết nối (chỉ có dòng trạng thái). */
  title: string | null;
  /** Máy của thẻ — nút "Chi tiết" mở thẻ chi tiết của máy này. */
  deviceId: string | null;
  /** Ô trỏ tới máy không còn trong kho. */
  missing?: boolean;
  rows: { key: HoverRowKey; value: string }[];
}

export function deviceHoverData(device: DiagramDeviceInfo | null, code: string): HoverCardData {
  if (!device?.found) return { kind: 'device', title: code, deviceId: null, missing: true, rows: [] };
  const where = [device.siteCode, device.cabinetCode, rackUnitLabel(device.u, device.uSize)].filter(Boolean).join(' · ');
  const ports = device.ports ?? { used: 0, declared: 0 };
  const rows: HoverCardData['rows'] = [
    { key: 'ip', value: device.ips.join(', ') },
    { key: 'model', value: device.model ?? '' },
    { key: 'location', value: where },
    { key: 'ports', value: `${ports.used}/${ports.declared}` },
    { key: 'status', value: device.status ?? '' },
  ];
  return { kind: 'device', title: device.code ?? code, deviceId: device.id, rows: rows.filter((row) => row.value !== '') };
}

export function cableHoverData(edge: CableEdge, link: DiagramLink | null, cableTypes: CableTypeInfo[]): HoverCardData {
  const linked = edge.state === 'linked' && link;
  const rows: HoverCardData['rows'] = [];
  const cable = linked && link.cableTypeId ? cableTypes.find((c) => c.id === link.cableTypeId) : undefined;
  if (cable) rows.push({ key: 'cableType', value: cable.name });
  rows.push({ key: 'state', value: edge.state });
  return {
    kind: 'cable',
    title: linked ? `${link.deviceCode}:${link.portLabel} ↔ ${link.peerDeviceCode}:${link.peerPort ?? '—'}` : null,
    deviceId: null,
    rows,
  };
}

const END_SUFFIX = /-ims-p[st]$/;

/** Ô được rê / chọn là máy nào hay dây nào. Nhãn cổng ở đầu dây là chính dây đó. */
export function hoverTarget(
  content: Pick<DiagramContent, 'deviceCells' | 'cableEdges'>,
  cellId: string,
): { kind: 'device'; deviceId: string; code: string } | { kind: 'cable'; edgeId: string } | null {
  const cell = (content.deviceCells ?? []).find((c) => c.cellId === cellId);
  if (cell) return { kind: 'device', deviceId: cell.deviceId, code: cell.code };
  const edgeId = cellId.replace(END_SUFFIX, '');
  if ((content.cableEdges ?? []).some((e) => e.cellId === edgeId)) return { kind: 'cable', edgeId };
  return null;
}

/** Ô sáng khi bấm / rê một máy: ô của máy, mọi nét dây chạm nó (kèm nhãn đầu), ô máy đầu kia (AD-18). */
export function focusCells(content: Pick<DiagramContent, 'deviceCells' | 'cableEdges'>, deviceId: string): string[] | null {
  const deviceCells = content.deviceCells ?? [];
  const own = deviceCells.filter((c) => c.deviceId === deviceId).map((c) => c.cellId);
  if (own.length === 0) return null;
  const edges = (content.cableEdges ?? []).filter((e) => e.sourceDeviceId === deviceId || e.targetDeviceId === deviceId);
  const far = new Set(edges.map((e) => (e.sourceDeviceId === deviceId ? e.targetDeviceId : e.sourceDeviceId)));
  const farCells = deviceCells.filter((c) => far.has(c.deviceId)).map((c) => c.cellId);
  return [...own, ...edges.flatMap((e) => [e.cellId, ...portEndIds(e.cellId)]), ...farCells];
}

/** Rê lên dây: cả dây + hai nhãn đầu + máy hai đầu; rê lên máy: như bấm máy. */
export function hoverHighlight(content: Pick<DiagramContent, 'deviceCells' | 'cableEdges'>, cellId: string): string[] | null {
  const target = hoverTarget(content, cellId);
  if (!target) return null;
  if (target.kind === 'device') return focusCells(content, target.deviceId);
  const edge = (content.cableEdges ?? []).find((e) => e.cellId === target.edgeId);
  if (!edge) return null;
  const ends = new Set([edge.sourceDeviceId, edge.targetDeviceId]);
  const devices = (content.deviceCells ?? []).filter((c) => ends.has(c.deviceId)).map((c) => c.cellId);
  return [edge.cellId, ...portEndIds(edge.cellId), ...devices];
}

/** Thẻ của ô đang rê trong tab Xem: máy theo thông tin kho kèm nội dung, dây theo sơ đồ cổng hiện tại. */
export function hoverCardOf(content: DiagramContent, cellId: string): HoverCardData | null {
  const target = hoverTarget(content, cellId);
  if (!target) return null;
  if (target.kind === 'device') {
    return deviceHoverData((content.devices ?? []).find((d) => d.id === target.deviceId) ?? null, target.code);
  }
  const edge = (content.cableEdges ?? []).find((e) => e.cellId === target.edgeId);
  if (!edge) return null;
  const link = edge.linkId ? ((content.links ?? []).find((l) => l.id === edge.linkId) ?? null) : null;
  return cableHoverData(edge, link, content.cableTypes ?? []);
}

/**
 * Ô đang chọn trong trình vẽ → máy hay dây của kho để hiện thẻ. Chọn nhiều ô, hay chọn hình tự do /
 * nét chưa gắn kết nối, thì không có thẻ: thẻ nói về MỘT thứ trong kho.
 */
export function selectedTarget(
  selection: DrawioSelected[],
): { kind: 'device'; cellId: string; deviceId: string; code: string } | { kind: 'cable'; cellId: string; linkId: string } | null {
  if (selection.length !== 1) return null;
  const [one] = selection;
  if (one.kind === 'node' && one.deviceId) return { kind: 'device', cellId: one.id, deviceId: one.deviceId, code: one.code ?? '' };
  if (one.kind === 'edge' && one.linkId) return { kind: 'cable', cellId: one.id, linkId: one.linkId };
  return null;
}
