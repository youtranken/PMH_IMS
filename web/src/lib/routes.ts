/**
 * Đường dẫn của IMS — NGUỒN DUY NHẤT (AD-15).
 *
 * Trước đây chuỗi đường dẫn nằm rải trong `App.tsx`, `app-nav.ts` và ~40 chỗ `<Link to>`.
 * Đổi một đường phải đi tìm bằng grep và sót một chỗ là một cái link chết mà không lỗi nào
 * báo. Từ giờ màn nào cần đường dẫn thì đọc ở đây.
 *
 * URL bằng tiếng Anh (quyết định của chủ dự án, 26/08/2026) còn GIAO DIỆN vẫn tiếng Việt:
 * đường dẫn là thứ lập trình viên, log và tài liệu kỹ thuật đọc; nhãn trên màn hình là thứ
 * người dùng đọc. Hai đối tượng khác nhau nên không phải cùng một ngôn ngữ.
 */
export const PATHS = {
  dashboard: '/',

  devices: '/devices',
  device: (id: string) => `/devices/${id}`,

  software: '/software',
  softwareItem: (id: string) => `/software/${id}`,

  ispLines: '/isp-lines',
  ispLine: (id: string) => `/isp-lines/${id}`,

  expiry: '/expiry',

  ipAddresses: '/ip-addresses',
  subnet: (id: string) => `/ip-addresses/${id}`,

  nat: '/nat',

  serviceAccounts: '/service-accounts',
  serviceAccount: (id: string) => `/service-accounts/${id}`,

  approvals: '/approvals',
  vault: '/vault',
  documents: '/documents',

  adminAccounts: '/admin/accounts',
  adminCatalog: '/admin/catalog',
  adminVaultAccess: '/admin/vault-access',
  adminAuditLog: '/admin/audit-log',

  devComponents: '/dev/components',
} as const;

/**
 * Đường dẫn tiếng Việt của bản cũ → đường mới.
 *
 * Giữ lại vì link đã gửi qua chat, đã ghim trong trình duyệt, đã dán vào biên bản sự cố —
 * chúng không tự sửa được. Mỗi dòng ở đây sinh một `<Route>` chuyển hướng `replace`, nên
 * người dùng bấm link cũ vẫn tới đúng chỗ và thanh địa chỉ đổi luôn sang đường mới.
 *
 * `:id` giữ nguyên: `react-router` khớp tham số rồi `Navigate` ghép lại ở phía kia.
 */
export interface LegacyRoute {
  from: string;
  to: string;
  /** Có tham số `:id` cần ghép lại vào đường mới. */
  withId?: boolean;
}

export const LEGACY_ROUTES: LegacyRoute[] = [
  { from: '/thiet-bi', to: PATHS.devices },
  { from: '/thiet-bi/:id', to: PATHS.devices, withId: true },
  { from: '/phan-mem', to: PATHS.software },
  { from: '/phan-mem/:id', to: PATHS.software, withId: true },
  { from: '/duong-truyen', to: PATHS.ispLines },
  { from: '/duong-truyen/:id', to: PATHS.ispLines, withId: true },
  { from: '/sap-het-han', to: PATHS.expiry },
  { from: '/dia-chi-ip', to: PATHS.ipAddresses },
  { from: '/dia-chi-ip/:id', to: PATHS.ipAddresses, withId: true },
  { from: '/so-nat', to: PATHS.nat },
  { from: '/duyet-yeu-cau', to: PATHS.approvals },
  { from: '/ket-sat', to: PATHS.vault },
  { from: '/tai-lieu', to: PATHS.documents },
  { from: '/quan-tri/tai-khoan', to: PATHS.adminAccounts },
  { from: '/quan-tri/danh-muc', to: PATHS.adminCatalog },
  { from: '/quan-tri/quyen-ket-sat', to: PATHS.adminVaultAccess },
  { from: '/quan-tri/nhat-ky', to: PATHS.adminAuditLog },
];
