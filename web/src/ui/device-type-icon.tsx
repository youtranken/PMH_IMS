import type { ReactNode } from 'react';

/**
 * Biểu tượng loại thiết bị trên giao diện IMS (PW-A18, Q-33) — danh sách ĐÓNG, khớp
 * `api/src/modules/catalog/device-type-icons.ts` (`device-type-icon-rollcall.test.ts` canh). Danh
 * mục chọn một biểu tượng cho mỗi loại; khung ảnh của máy chưa có ảnh thật hiện biểu tượng đó.
 *
 * Nét `currentColor`, cỡ `1em` như `ui/glyph-icons` — to nhỏ theo `font-size` của khung bọc.
 * `aria-hidden`: tên loại nằm ở khung bọc (`role="img"` + `aria-label`).
 */
export const DEVICE_TYPE_ICON_KEYS = [
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

export type DeviceTypeIconKey = (typeof DEVICE_TYPE_ICON_KEYS)[number];

/** Khóa tên tiếng Việt của từng biểu tượng — viết hẳn từng khóa để bài điểm danh khóa dịch thấy. */
export const DEVICE_TYPE_ICON_LABEL_KEY: Record<DeviceTypeIconKey, string> = {
  switch: 'deviceTypeIcon.switch',
  router: 'deviceTypeIcon.router',
  firewall: 'deviceTypeIcon.firewall',
  server: 'deviceTypeIcon.server',
  nas: 'deviceTypeIcon.nas',
  ups: 'deviceTypeIcon.ups',
  access_point: 'deviceTypeIcon.access_point',
  pc: 'deviceTypeIcon.pc',
  laptop: 'deviceTypeIcon.laptop',
  printer: 'deviceTypeIcon.printer',
  camera: 'deviceTypeIcon.camera',
  phone: 'deviceTypeIcon.phone',
};

const PATHS: Record<DeviceTypeIconKey | 'generic', ReactNode> = {
  switch: (
    <>
      <rect x="2" y="8" width="20" height="8" rx="1.5" />
      <path d="M5.5 12h1M8.5 12h1M11.5 12h1M14.5 12h1M17.5 12h1" />
    </>
  ),
  router: (
    <>
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 16.5h.01M10.5 16.5h.01M8 13V9M16 13V9M5.5 6.5a9 9 0 0 1 13 0" />
    </>
  ),
  firewall: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 9.3h18M3 14.7h18M9 4v5.3M15 4v5.3M6 9.3v5.4M12 9.3v5.4M18 9.3v5.4M9 14.7V20M15 14.7V20" />
    </>
  ),
  server: (
    <>
      <rect x="4" y="3" width="16" height="8" rx="1.5" />
      <rect x="4" y="13" width="16" height="8" rx="1.5" />
      <path d="M7.5 7h.01M7.5 17h.01M11 7h5M11 17h5" />
    </>
  ),
  nas: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M8 7h8M8 11h8M8 15h8M12 18.5h.01" />
    </>
  ),
  ups: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="1.5" />
      <path d="M10 2.5V4M14 2.5V4M12.8 8l-2.6 4.5h3.6L11.2 17" />
    </>
  ),
  access_point: (
    <>
      <rect x="3" y="16" width="18" height="5" rx="2.5" />
      <path d="M8.5 12.5a5 5 0 0 1 7 0M5.5 9.5a9.2 9.2 0 0 1 13 0M12 18.5h.01" />
    </>
  ),
  pc: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  laptop: (
    <>
      <rect x="5" y="5" width="14" height="10" rx="1" />
      <path d="M2.5 19h19l-2-4h-15z" />
    </>
  ),
  printer: (
    <>
      <path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <rect x="7" y="14" width="10" height="7" />
    </>
  ),
  camera: (
    <>
      <path d="M3 7.5 16 10l-1.2 5L2.2 12.5z" />
      <path d="M16 10.5l4-1.5v5.5l-5 .8M8 13.6V18H4" />
    </>
  ),
  phone: (
    <>
      <rect x="9" y="4" width="11" height="16" rx="1.5" />
      <path d="M9 6H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3M12.5 8h4M12.5 12h.01M14.5 12h.01M16.5 12h.01M12.5 15h.01M14.5 15h.01M16.5 15h.01" />
    </>
  ),
  generic: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 12h18M6.5 9h.01M6.5 15h.01M10 9h7M10 15h7" />
    </>
  ),
};

export function isDeviceTypeIconKey(value: string | null | undefined): value is DeviceTypeIconKey {
  return !!value && (DEVICE_TYPE_ICON_KEYS as readonly string[]).includes(value);
}

/** Biểu tượng của một loại; tên lạ / `null` thì hình "thiết bị chung". */
export function DeviceTypeIcon({ icon, className }: { icon: string | null | undefined; className?: string }) {
  return (
    <svg
      className={['glyph', className].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={isDeviceTypeIconKey(icon) ? icon : 'generic'}
    >
      {PATHS[isDeviceTypeIconKey(icon) ? icon : 'generic']}
    </svg>
  );
}

/** Ảnh riêng của loại đã thu nhỏ — `v` đổi theo tệp để trình duyệt bỏ bản đệm cũ. */
export function deviceTypePhotoSrc(typeId: string, photoFileId: string): string {
  return `/api/v1/catalog/device-types/${typeId}/photo?v=${encodeURIComponent(photoFileId)}`;
}
