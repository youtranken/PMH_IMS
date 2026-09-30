import type { Me } from '@/lib/me';
import { PATHS, titleKeyOf } from '@/lib/routes';
import { DEV_KIT_ENABLED } from '@/lib/dev-kit';

interface NavItem {
  /** Khóa i18n (`nav.*`) — nhãn không bao giờ viết cứng. */
  key: string;
  /** Nhãn riêng cho Member khi cùng một màn làm việc khác hẳn theo vai. */
  memberKey?: string;
  to: string;
  /** Vai được nhìn thấy mục này. UI ẩn cho gọn; quyền THẬT do RolesGuard ở API (AD-9). */
  roles?: Me['role'][];
  /** Mục mang số việc đang chờ — shell tự hỏi số và vẽ `.nav-badge`. */
  badge?: 'approvals' | 'overdue';
}

export interface NavGroup {
  labelKey: string;
  items: NavItem[];
  /**
   * Tiêu đề nhóm thành nút khép/mở, mặc định khép. Chỉ cho nhóm ít dùng hằng ngày: menu của SA
   * dài hơn màn laptop 768–900px, và cuộn sidebar để tìm "Thiết bị" là cái giá trả mỗi ngày
   * cho vài mục quản trị mở mỗi tuần một lần (Q-18).
   */
  collapsible?: boolean;
}

/**
 * Sidebar của IMS. Chỉ liệt kê màn đã có: mục "sắp có" chiếm chỗ trên một menu vốn đã dài
 * mà không đưa người dùng tới đâu (Q-18).
 *
 * Nhóm theo VIỆC người trực đang làm, không theo thứ tự làm ra màn: một danh sách phẳng mười
 * mấy mục thì khó quét, nhất là trong drawer điện thoại. Tài khoản dịch vụ đứng trong "Tài sản"
 * cạnh thiết bị/phần mềm; két sắt và duyệt mở két đứng chung "Bảo mật".
 */
const allNavGroups: NavGroup[] = [
  {
    labelKey: 'nav.groupOverview',
    items: [
      { key: 'nav.dashboard', to: PATHS.dashboard },
      { key: 'nav.expiry', to: PATHS.expiry, badge: 'overdue' },
    ],
  },
  {
    labelKey: 'nav.groupAssets',
    items: [
      { key: 'nav.devices', to: PATHS.devices },
      { key: 'nav.software', to: PATHS.software },
      { key: 'nav.isp', to: PATHS.ispLines },
      // Tài khoản dùng chung + VPN — mật khẩu của chúng nằm ở két sắt.
      { key: 'nav.serviceAccounts', to: PATHS.serviceAccounts },
      /* Kho thanh lý cho MỌI vai: "cái máy này đâu rồi" là câu ai trong team IT cũng hỏi, và
         "đã thanh lý tháng trước" không phải bí mật gì. */
      { key: 'nav.disposal', to: PATHS.disposal },
    ],
  },
  {
    labelKey: 'nav.groupNetwork',
    items: [
      { key: 'nav.ipam', to: PATHS.ipAddresses },
      { key: 'nav.nat', to: PATHS.nat },
    ],
  },
  {
    labelKey: 'nav.groupSecurity',
    items: [
      // MỌI vai thấy: Member vào xem yêu cầu của mình đã được duyệt chưa — với họ đây là
      // "yêu cầu xem két của tôi", không phải màn duyệt.
      { key: 'nav.approvals', memberKey: 'nav.approvalsMine', to: PATHS.approvals, badge: 'approvals' },
      /*
       * CHỈ SA/Admin: trang tổng là bản đồ "công ty giữ bí mật ở đâu" và `GET /vault/owners`
       * chặn theo vai. Bỏ `roles` thì Member bấm vào và nhận một màn lỗi "thử lại" — bày ra
       * một cánh cửa khóa còn tệ hơn không bày. (Két sắt của TỪNG hồ sơ thì Member vẫn thấy —
       * đó là tab trong trang chi tiết, quyền nằm ở ma trận 6.2.)
       */
      { key: 'nav.vault', to: PATHS.vault, roles: ['sa', 'admin'] },
    ],
  },
  {
    labelKey: 'nav.groupAdmin',
    collapsible: true,
    items: [
      { key: 'nav.accounts', to: PATHS.adminAccounts, roles: ['sa'] },
      // Member vào xem được (form thiết bị cần biết danh mục có gì); sửa thì API chặn.
      { key: 'nav.catalog', to: PATHS.adminCatalog },
      // Ma trận quyền két sắt là bản đồ phòng thủ — chỉ SA/Admin thấy.
      { key: 'nav.vaultAccess', to: PATHS.adminVaultAccess, roles: ['sa', 'admin'] },
      { key: 'nav.auditLog', to: PATHS.adminAuditLog, roles: ['sa', 'admin'] },
      // Nới/siết mọi hàng rào đăng nhập và két — chỉ SA (Q-14), khớp gác ở App.tsx và API.
      { key: 'nav.settings', to: PATHS.adminSettings, roles: ['sa'] },
    ],
  },
  {
    /* Trang nội bộ của đội phát triển (dữ liệu giả) — nhóm riêng ở cuối, nhãn nói rõ, để SA
       không tưởng đây là một chức năng thật. Chỉ SA thấy, khớp gác quyền ở App.tsx. */
    labelKey: 'nav.groupDev',
    items: [{ key: 'nav.components', to: PATHS.devComponents, roles: ['sa'] }],
  },
];

/** Nhóm dev (Bộ giao diện) chỉ có khi build bật cờ — bản production không có (FE-09). */
export const navGroups: NavGroup[] = allNavGroups.filter(
  (group) => DEV_KIT_ENABLED || group.labelKey !== 'nav.groupDev',
);

export function visibleGroups(me: Me | null): NavGroup[] {
  if (!me) return [];
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || item.roles.includes(me.role)),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Nhóm menu chứa màn đang mở — `null` nếu màn không có mục trên menu (Hồ sơ, 404).
 *
 * Đi qua `titleKeyOf` chứ không tự khớp tiền tố: trang chi tiết đội nhóm của danh sách nó thuộc
 * về theo đúng luật của tên tab, và cái bẫy `'/'` là tiền tố của mọi đường chỉ phải gỡ một chỗ.
 */
export function groupOfPath(groups: NavGroup[], pathname: string): NavGroup | null {
  const key = titleKeyOf(pathname);
  if (!key) return null;
  return groups.find((group) => group.items.some((item) => item.key === key)) ?? null;
}
