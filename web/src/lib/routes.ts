import type { SecretOwnerType } from '@/lib/secret-owner-kinds';
import type { UserRole } from '@/lib/me';

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
  /** Mở dải ở ĐÚNG một địa chỉ: màn tự nhảy tới trang chứa nó và tô sáng dòng. */
  subnetAt: (id: string, ip: string) => `/ip-addresses/${id}?ip=${encodeURIComponent(ip)}`,

  nat: '/nat',

  serviceAccounts: '/service-accounts',
  serviceAccount: (id: string) => `/service-accounts/${id}`,

  approvals: '/approvals',
  /** Một yêu cầu — đích của nút trong thư duyệt, quyết được trên điện thoại. */
  approval: (id: string) => `/approvals/${id}`,
  vault: '/vault',
  /** Kho thanh lý — màn TỔNG hợp mọi hồ sơ đã ngừng dùng, không phải một bảng riêng. */
  disposal: '/disposal',
  documents: '/documents',

  adminAccounts: '/admin/accounts',
  adminCatalog: '/admin/catalog',
  adminVaultAccess: '/admin/vault-access',
  adminAuditLog: '/admin/audit-log',

  devComponents: '/dev/components',

  /** Hồ sơ của tôi — mở cho mọi vai; vào từ menu tài khoản ở chân sidebar. */
  profile: '/profile',
} as const;

/**
 * Loại chủ thể → đường tới hồ sơ của nó.
 *
 * Khóa là `SecretOwnerType` — cùng danh sách với `SECRET_OWNER_TYPES` bên API, và trùng khít
 * bốn loại của kho thanh lý. Trước 12/09 union này gõ tay lần thứ hai ngay tại đây.
 *
 * Có mặt vì ba màn TỔNG — kho thanh lý, khối "vừa thanh lý" và khối "két lâu không đổi" trên
 * bảng điều khiển — đều nhận một cặp `(ownerType, id)` rồi phải tự dựng link. Ba bản chép tay
 * là ba chỗ phải nhớ sửa khi có loại thứ năm, và chỗ quên sẽ hiện ra một link chết chứ không
 * phải một lỗi biên dịch. Ở đây thì `Record` bắt đủ khóa: thiếu một loại là TS đỏ ngay.
 */
export const OWNER_PATH: Record<SecretOwnerType, (id: string) => string> = {
  device: (id) => PATHS.device(id),
  software: (id) => PATHS.softwareItem(id),
  service_account: (id) => PATHS.serviceAccount(id),
  isp: (id) => PATHS.ispLine(id),
};

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

/**
 * VAI NÀO ĐƯỢC VÀO ĐƯỜNG NÀO — mặc-định-ĐÓNG cho mọi màn quản trị (B-09, 22/09).
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `/vault` và `/dev/components` gác ngay ở `<Route>`: gõ thẳng URL cũng chỉ nhận 404.
 * `/admin/accounts` và `/admin/vault-access` thì KHÔNG — Member gõ URL vào là màn dựng đủ
 * `h1`, phụ đề, và một nút "Thêm tài khoản" BẤM ĐƯỢC, rồi mới báo không có quyền.
 *
 * Dữ liệu không rò (API trả 403 sạch), nên đây không phải lỗ bảo mật. Nhưng nó dạy sai: một
 * màn dựng ra đủ hình hài rồi mới từ chối trông như một lỗi hệ thống, không như một ranh giới
 * quyền. Người dùng bấm nút, bị từ chối, và báo là "hệ thống hỏng". Hai cửa cùng loại mà cư
 * xử khác nhau thì cái nào đúng cũng không ai tin nữa.
 *
 * ===== VÌ SAO LÀ MỘT BẢNG, KHÔNG PHẢI MẤY CÂU `? :` TRONG JSX =====
 *
 * Gác bằng biểu thức rải trong `App.tsx` thì màn thứ năm viết sau sẽ quên — đúng như hai màn
 * này đã quên. Bảng ở đây cho phép hỏi một câu mà JSX không trả lời được: "có đường `/admin`
 * nào CHƯA khai vai không?" Bài kiểm hỏi đúng câu đó, nên thêm màn quản trị mà quên khai vai
 * là ĐỎ ngay, không phải chờ ai đó gõ URL bằng tay.
 *
 * Danh sách vai lấy đúng theo `@Roles` của API tương ứng — giao diện không được rộng hơn cửa
 * sau nó, cũng không được hẹp hơn (hẹp hơn thì giấu mất một màn người ta có quyền xem).
 */
export const ROUTE_ROLES: Record<string, readonly UserRole[]> = {
  // `accounts.controller.ts` — toàn bộ là `@Roles('sa')`.
  [PATHS.adminAccounts]: ['sa'],
  // `vault-access.controller.ts` — `@Roles('sa', 'admin')`.
  [PATHS.adminVaultAccess]: ['sa', 'admin'],
  // `audit.controller.ts` — `@Roles('sa', 'admin')` ở cấp lớp.
  [PATHS.adminAuditLog]: ['sa', 'admin'],
  // `catalog.controller.ts` — đường ĐỌC mở cho cả `member`, nên màn này không gác theo vai.
  [PATHS.adminCatalog]: ['sa', 'admin', 'member'],
  [PATHS.vault]: ['sa', 'admin'],
  [PATHS.devComponents]: ['sa'],
};

/** Vai này vào được đường kia không. Đường không khai trong bảng = mở cho mọi vai. */
export function canSeeRoute(path: string, role: UserRole): boolean {
  const allowed = ROUTE_ROLES[path];
  return allowed === undefined || allowed.includes(role);
}

/**
 * Đường dẫn → khoá i18n làm TÊN TAB TRÌNH DUYỆT (B-03).
 *
 * Dùng LẠI khoá `nav.*` chứ không đẻ bộ khoá thứ hai: tab trình duyệt và mục sidebar trỏ vào
 * cùng một màn, nên hai cái tên khác nhau cho nó là đúng thứ `term-consistency.test.ts` vừa
 * phải dọn sáu lần. Đổi nhãn sidebar thì tab đổi theo, không lệch được.
 *
 * Bảng, không phải `useEffect` rải ở mười lăm màn: thiếu một dòng effect thì trang vẫn dựng
 * ra bình thường và không gì đỏ, nên màn thứ mười sáu sẽ quên. Ở đây thì `routes.test.ts` hỏi
 * được "có đường nào trong `PATHS` chưa có tên tab không".
 */
export const ROUTE_TITLE_KEY: Record<string, string> = {
  [PATHS.dashboard]: 'nav.dashboard',
  [PATHS.devices]: 'nav.devices',
  [PATHS.software]: 'nav.software',
  [PATHS.ispLines]: 'nav.isp',
  [PATHS.expiry]: 'nav.expiry',
  [PATHS.ipAddresses]: 'nav.ipam',
  [PATHS.nat]: 'nav.nat',
  [PATHS.serviceAccounts]: 'nav.serviceAccounts',
  [PATHS.approvals]: 'nav.approvals',
  [PATHS.vault]: 'nav.vault',
  [PATHS.disposal]: 'nav.disposal',
  [PATHS.documents]: 'nav.documents',
  [PATHS.adminAccounts]: 'nav.accounts',
  [PATHS.adminCatalog]: 'nav.catalog',
  [PATHS.adminVaultAccess]: 'nav.vaultAccess',
  [PATHS.adminAuditLog]: 'nav.auditLog',
  [PATHS.devComponents]: 'nav.components',
  [PATHS.profile]: 'profile.title',
};

/**
 * Tên tab cho một `pathname` — `null` nếu không nhận ra.
 *
 * Trang CHI TIẾT (`/devices/<id>`) đội tên của danh sách nó thuộc về: người dùng nhận ra khu
 * vực trước, còn tên riêng của hồ sơ đã nằm trên `h1` của chính trang. Ghép tên hồ sơ vào tab
 * thì phải chờ API trả về, tức tab đổi tên hai lần mỗi lượt mở màn.
 *
 * `'/'` bị loại khỏi phép khớp tiền tố một cách tường minh — nó là tiền tố của MỌI đường, nên
 * quên vế đó thì mọi màn đội tên "Bảng điều khiển", và bảng kiểm khai theo đường cụ thể vẫn
 * xanh vì `/` chỉ thắng ở những đường KHÔNG khai.
 *
 * Trả `null` chứ không đoán bừa: tab của một trang 404 mà mang tên một màn có thật là nói với
 * người dùng rằng trang ấy tồn tại.
 */
export function titleKeyOf(pathname: string): string | null {
  const exact = ROUTE_TITLE_KEY[pathname];
  if (exact) return exact;

  const prefix = Object.keys(ROUTE_TITLE_KEY)
    .filter((path) => path !== '/' && pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];

  return prefix ? ROUTE_TITLE_KEY[prefix] : null;
}
