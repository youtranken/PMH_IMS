/**
 * Biểu tượng loại thiết bị trên giao diện IMS (PW-A18) — danh sách ĐÓNG. Web vẽ đúng các tên này
 * (`web/src/ui/device-type-icon.tsx`; `device-type-icon-rollcall.test.ts` đọc file này để canh hai
 * bên khớp). Thêm biểu tượng = thêm tên ở đây VÀ hình ở web; không có ô gõ tên tự do.
 */
export const DEVICE_TYPE_ICONS = [
  'switch',
  'router',
  'firewall',
  'server',
  'nas',
  'ups',
  'access_point',
  'pc',
  'laptop',
  'printer',
  'camera',
  'phone',
] as const;

export type DeviceTypeIcon = (typeof DEVICE_TYPE_ICONS)[number];

export function isDeviceTypeIcon(value: string): value is DeviceTypeIcon {
  return (DEVICE_TYPE_ICONS as readonly string[]).includes(value);
}
