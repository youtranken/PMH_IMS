/**
 * Hình draw.io mà một loại thiết bị được chọn làm biểu tượng trên sơ đồ mạng (AD-18).
 * Danh sách ĐÓNG: màn Danh mục chỉ cho chọn trong đây, không có ô gõ style tự do — một ô
 * style tự do là đường chèn `image=https://…` (trình vẽ/trình xem tải ảnh ngoài bằng máy người xem).
 *
 * Tên hình là tên stencil có sẵn trong draw.io tự host (thư mục `stencils/` của bản ghim ở
 * `web/Dockerfile`): `mxgraph.<thư viện>.<tên hình viết thường, khoảng trắng thành _>`. Nâng
 * draw.io thì đối chiếu lại danh sách này. Cỡ là cỡ lúc CHÈN; người vẽ kéo to nhỏ tự do sau đó.
 */
export interface DiagramShapeDef {
  key: string;
  label: string;
  width: number;
  height: number;
}

export const DIAGRAM_SHAPES: readonly DiagramShapeDef[] = [
  { key: 'mxgraph.networks.switch', label: 'Switch (mạng)', width: 100, height: 30 },
  { key: 'mxgraph.cisco.switches.workgroup_switch', label: 'Switch (Cisco)', width: 64, height: 32 },
  { key: 'mxgraph.cisco.switches.layer_3_switch', label: 'Switch lớp 3 (Cisco)', width: 64, height: 64 },
  { key: 'mxgraph.networks.router', label: 'Router (mạng)', width: 100, height: 30 },
  { key: 'mxgraph.cisco.routers.router', label: 'Router (Cisco)', width: 64, height: 42 },
  { key: 'mxgraph.networks.firewall', label: 'Tường lửa (mạng)', width: 60, height: 60 },
  { key: 'mxgraph.cisco.security.firewall', label: 'Tường lửa (Cisco)', width: 32, height: 64 },
  { key: 'mxgraph.networks.server', label: 'Máy chủ', width: 54, height: 72 },
  { key: 'mxgraph.cisco.servers.fileserver', label: 'Máy chủ (Cisco)', width: 43, height: 62 },
  { key: 'mxgraph.networks.nas_filer', label: 'NAS', width: 60, height: 60 },
  { key: 'mxgraph.networks.storage', label: 'Lưu trữ', width: 60, height: 60 },
  { key: 'mxgraph.networks.ups_small', label: 'UPS nhỏ', width: 45, height: 60 },
  { key: 'mxgraph.networks.ups_enterprise', label: 'UPS tủ', width: 60, height: 80 },
  { key: 'mxgraph.networks.wireless_hub', label: 'Điểm phát Wi-Fi', width: 60, height: 40 },
  { key: 'mxgraph.cisco.wireless.wlan_controller', label: 'Bộ điều khiển Wi-Fi (Cisco)', width: 64, height: 32 },
  { key: 'mxgraph.networks.pc', label: 'Máy trạm', width: 60, height: 54 },
  { key: 'mxgraph.networks.laptop', label: 'Laptop', width: 64, height: 40 },
  { key: 'mxgraph.networks.printer', label: 'Máy in', width: 60, height: 54 },
  { key: 'mxgraph.networks.security_camera', label: 'Camera', width: 60, height: 40 },
  { key: 'mxgraph.cisco.modems_and_phones.ip_phone', label: 'Điện thoại IP', width: 54, height: 36 },
  { key: 'mxgraph.networks.modem', label: 'Modem', width: 60, height: 24 },
  { key: 'mxgraph.networks.load_balancer', label: 'Cân bằng tải', width: 100, height: 30 },
  { key: 'mxgraph.networks.patch_panel', label: 'Patch panel', width: 100, height: 20 },
];

/** "Thiết bị khác": loại chưa chọn hình nào hiện khối chữ nhật bo góc, cỡ đủ cho mã máy. */
export const DIAGRAM_SHAPE_OTHER = { label: 'Thiết bị khác', width: 120, height: 50 } as const;

/** Biểu tượng SVG riêng chèn với cỡ vuông này; giữ tỉ lệ ảnh (`aspect=fixed`). */
export const DIAGRAM_ICON_SIZE = { width: 60, height: 60 } as const;

export function diagramShapeDef(key: string | null | undefined): DiagramShapeDef | null {
  if (!key) return null;
  return DIAGRAM_SHAPES.find((shape) => shape.key === key) ?? null;
}
