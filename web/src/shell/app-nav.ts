import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';

export interface NavItem {
  /** Khóa i18n (`nav.*`) — nhãn không bao giờ viết cứng. */
  key: string;
  to: string;
  /** Vai được nhìn thấy mục này. UI ẩn cho gọn; quyền THẬT do RolesGuard ở API (AD-9). */
  roles?: Me['role'][];
  /** Màn chưa làm (epic sau) — hiện mờ, không điều hướng được. */
  planned?: boolean;
}

export interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

/**
 * Sidebar của IMS. Mục của epic sau đã có chỗ sẵn (`planned: true`) để bản đồ điều hướng
 * không phải vẽ lại mỗi epic — thêm màn chỉ là bỏ cờ `planned`.
 */
export const navGroups: NavGroup[] = [
  {
    labelKey: 'nav.groupWork',
    items: [
      { key: 'nav.dashboard', to: PATHS.dashboard },
      { key: 'nav.devices', to: PATHS.devices },
      { key: 'nav.software', to: PATHS.software },
      { key: 'nav.isp', to: PATHS.ispLines },
      { key: 'nav.expiry', to: PATHS.expiry },
      { key: 'nav.ipam', to: PATHS.ipAddresses },
      { key: 'nav.nat', to: PATHS.nat },
      // Tài khoản dùng chung + VPN (0032) — mật khẩu của chúng nằm ở két sắt.
      { key: 'nav.serviceAccounts', to: PATHS.serviceAccounts },
      // MỌI vai thấy: Member vào xem yêu cầu của mình đã được duyệt chưa.
      { key: 'nav.approvals', to: PATHS.approvals },
      /*
       * Không còn `planned`: két sắt đã chạy từ Epic 4, chỉ thiếu cửa vào từ menu.
       *
       * Nhưng CHỈ SA/Admin: trang tổng là bản đồ "công ty giữ bí mật ở đâu" và
       * `GET /vault/owners` chặn theo vai. Bỏ `roles` thì Member bấm vào và nhận một màn
       * lỗi "thử lại" — bày ra một cánh cửa khóa còn tệ hơn không bày.
       * (Két sắt của TỪNG hồ sơ thì Member vẫn thấy — đó là tab trong trang chi tiết,
       * quyền nằm ở ma trận 6.2.)
       */
      { key: 'nav.vault', to: PATHS.vault, roles: ['sa', 'admin'] },
      { key: 'nav.documents', to: PATHS.documents, planned: true },
    ],
  },
  {
    labelKey: 'nav.groupAdmin',
    items: [
      { key: 'nav.accounts', to: PATHS.adminAccounts, roles: ['sa'] },
      // Member vào xem được (form thiết bị cần biết danh mục có gì); sửa thì API chặn.
      { key: 'nav.catalog', to: PATHS.adminCatalog },
      // Ma trận quyền két sắt là bản đồ phòng thủ — chỉ SA/Admin thấy.
      { key: 'nav.vaultAccess', to: PATHS.adminVaultAccess, roles: ['sa', 'admin'] },
      { key: 'nav.auditLog', to: PATHS.adminAuditLog, roles: ['sa', 'admin'], planned: true },
      // Trang nội bộ của đội phát triển — chỉ SA thấy (khớp gác quyền ở App.tsx).
      { key: 'nav.components', to: PATHS.devComponents, roles: ['sa'] },
    ],
  },
];

export function visibleGroups(me: Me | null): NavGroup[] {
  if (!me) return [];
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || item.roles.includes(me.role)),
    }))
    .filter((group) => group.items.length > 0);
}
