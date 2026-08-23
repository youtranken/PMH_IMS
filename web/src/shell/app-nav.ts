import type { Me } from '@/lib/me';

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
      { key: 'nav.dashboard', to: '/', planned: true },
      { key: 'nav.devices', to: '/thiet-bi' },
      { key: 'nav.software', to: '/phan-mem' },
      { key: 'nav.isp', to: '/duong-truyen' },
      { key: 'nav.expiry', to: '/sap-het-han' },
      { key: 'nav.ipam', to: '/dia-chi-ip' },
      { key: 'nav.nat', to: '/so-nat' },
      { key: 'nav.vault', to: '/ket-sat', planned: true },
      { key: 'nav.documents', to: '/tai-lieu', planned: true },
    ],
  },
  {
    labelKey: 'nav.groupAdmin',
    items: [
      { key: 'nav.accounts', to: '/quan-tri/tai-khoan', roles: ['sa'] },
      // Member vào xem được (form thiết bị cần biết danh mục có gì); sửa thì API chặn.
      { key: 'nav.catalog', to: '/quan-tri/danh-muc' },
      // Ma trận quyền két sắt là bản đồ phòng thủ — chỉ SA/Admin thấy.
      { key: 'nav.vaultAccess', to: '/quan-tri/quyen-ket-sat', roles: ['sa', 'admin'] },
      { key: 'nav.auditLog', to: '/quan-tri/nhat-ky', roles: ['sa', 'admin'], planned: true },
      // Trang nội bộ của đội phát triển — chỉ SA thấy (khớp gác quyền ở App.tsx).
      { key: 'nav.components', to: '/dev/components', roles: ['sa'] },
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
