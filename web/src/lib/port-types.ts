import { nextPortLabel, sortByPortLabel } from './port-label';

/** Hình dạng sơ đồ cổng (`api/v1/devices/:id/ports`, AD-14) — trang thiết bị và màn sơ đồ mạng cùng đọc. */

export interface PortRow {
  id: string;
  portLabel: string;
  connectedDeviceId: string | null;
  connectedDeviceCode: string | null;
  connectedDeviceName: string | null;
  connectedLabel: string | null;
  connectedPort: string | null;
  usedBy: string | null;
  /** VLAN của cổng — text vì "trunk" là giá trị có thật trên uplink. */
  vlan: string | null;
  note: string | null;
  /** Loại dây (danh mục `cable_type`); vắng ở dữ liệu cũ. */
  cableTypeId?: string | null;
}

export interface IncomingPortRow {
  id: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  portLabel: string;
  connectedPort: string | null;
  usedBy: string | null;
  vlan: string | null;
  note: string | null;
  cableTypeId?: string | null;
}

export interface PortMap {
  ports: PortRow[];
  incoming: IncomingPortRow[];
}

/** Một sợi dây giữa hai máy có hồ sơ — `id` là id dòng sơ đồ cổng (= `ims_link_id` trên nét vẽ). */
export interface PortLink {
  id: string;
  /** Máy giữ bản ghi. */
  deviceId: string;
  deviceCode: string;
  portLabel: string;
  peerDeviceId: string;
  peerDeviceCode: string;
  peerPort: string | null;
  cableTypeId: string | null;
  vlan: string | null;
  note: string | null;
}

/**
 * Cổng CÒN TRỐNG của một máy để gợi ý khi khai dây: dòng của chính máy chưa nối đâu (chỉ ghi
 * VLAN/người dùng), trừ cổng mà dòng của máy khác đang cắm vào. Không phân biệt hoa/thường (Q-20).
 * Đây chỉ là gợi ý — server vẫn là bên kiểm luật một cổng một cáp.
 */
export function freePorts(map: PortMap | undefined): string[] {
  if (!map) return [];
  const taken = new Set(map.incoming.map((row) => (row.connectedPort ?? '').toLowerCase()).filter(Boolean));
  return map.ports
    .filter((row) => !row.connectedDeviceId && !row.connectedLabel && !taken.has(row.portLabel.toLowerCase()))
    .map((row) => row.portLabel);
}

/** Dây đã có giữa đúng hai máy (cả hai chiều ghi) — "gắn vào một dòng sơ đồ cổng có sẵn". */
export function linksBetween(map: PortMap | undefined, self: { id: string; code: string }, peerId: string): PortLink[] {
  if (!map) return [];
  const own = map.ports
    .filter((row) => row.connectedDeviceId === peerId)
    .map((row) => ({
      id: row.id,
      deviceId: self.id,
      deviceCode: self.code,
      portLabel: row.portLabel,
      peerDeviceId: peerId,
      peerDeviceCode: row.connectedDeviceCode ?? '',
      peerPort: row.connectedPort,
      cableTypeId: row.cableTypeId ?? null,
      vlan: row.vlan,
      note: row.note,
    }));
  const incoming = map.incoming
    .filter((row) => row.deviceId === peerId)
    .map((row) => ({
      id: row.id,
      deviceId: peerId,
      deviceCode: row.deviceCode,
      portLabel: row.portLabel,
      peerDeviceId: self.id,
      peerDeviceCode: self.code,
      peerPort: row.connectedPort,
      cableTypeId: row.cableTypeId ?? null,
      vlan: row.vlan,
      note: row.note,
    }));
  return [...own, ...incoming];
}

/**
 * Cổng ĐÃ có cáp của một máy, kèm đầu kia (mã máy hoặc chữ ghi tay): dòng của chính máy đã nối đi,
 * cộng cổng mà dòng của máy khác đang cắm vào. Hộp "Khai" hiện danh sách này để người vẽ không gõ
 * lại một cổng đã chiếm (luật một cổng một cáp) — server vẫn là bên kiểm cuối.
 */
export function usedPorts(map: PortMap | undefined): { label: string; peer: string }[] {
  if (!map) return [];
  const own = map.ports
    .filter((row) => row.connectedDeviceId || row.connectedLabel)
    .map((row) => ({ portLabel: row.portLabel, peer: row.connectedDeviceCode ?? row.connectedLabel ?? '' }));
  const incoming = map.incoming.filter((row) => row.connectedPort).map((row) => ({ portLabel: row.connectedPort ?? '', peer: row.deviceCode }));
  return sortByPortLabel([...own, ...incoming]).map((row) => ({ label: row.portLabel, peer: row.peer }));
}

/** Đầu kia đang giữ cổng `label` (không phân biệt hoa/thường), `null` = cổng chưa có cáp. */
export function portTakenBy(map: PortMap | undefined, label: string): string | null {
  const key = label.trim().toLowerCase();
  if (!key) return null;
  return usedPorts(map).find((row) => row.label.toLowerCase() === key)?.peer ?? null;
}

/** Trần số bước dò cổng trống — switch lớn nhất cũng dưới chừng này cổng. */
const NEXT_FREE_STEPS = 512;

/**
 * Cổng trống gần nhất tính từ `label` (chính nó nếu còn trống), tăng số cuối của nhãn. Nhãn không
 * có số cuối thì không đoán — `''`.
 */
export function nextFreePort(map: PortMap | undefined, label: string): string {
  let candidate = label.trim();
  for (let step = 0; step < NEXT_FREE_STEPS && candidate; step += 1) {
    if (!portTakenBy(map, candidate)) return candidate;
    candidate = nextPortLabel(candidate);
  }
  return '';
}
