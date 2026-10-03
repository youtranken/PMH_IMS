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
