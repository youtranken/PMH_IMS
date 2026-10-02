import { PATHS } from './routes';

/** Loại hồ sơ phần mềm — khớp `SOFTWARE_KINDS` phía API. */
export const SOFTWARE_KINDS = ['license', 'ssl', 'domain', 'maintenance', 'other'] as const;
export type SoftwareKind = (typeof SOFTWARE_KINDS)[number];

export type SoftwareScreenKey = 'software' | 'domains' | 'maintenance' | 'services';

/**
 * Một màn tách từ "Phần mềm" (Q-22): những loại nó giữ, đường dẫn, và bộ chữ của nó.
 *
 * Bốn màn dùng CHUNG một component danh sách, một trang chi tiết và một form (AD-15) — chỉ bảng
 * này khác nhau. Lưu trữ vẫn một bảng `software` với cột `kind` (Q-22), nên đây không phải bốn
 * module: thêm một màn thứ năm là thêm một dòng ở đây, không chép component.
 */
export interface SoftwareScreenSpec {
  key: SoftwareScreenKey;
  /** Loại thuộc màn này, theo thứ tự hiện trong ô chọn Loại. */
  kinds: readonly SoftwareKind[];
  list: string;
  item: (id: string) => string;
  /** Nhãn menu — cũng là tên tab trình duyệt và crumb đầu của trang chi tiết. */
  navKey: string;
  titleKey: string;
  subtitleKey: string;
  addKey: string;
  emptyKey: string;
  emptyHintKey: string;
  searchKey: string;
  exportFile: string;
}

export const SOFTWARE_SCREENS: Record<SoftwareScreenKey, SoftwareScreenSpec> = {
  software: {
    key: 'software',
    kinds: ['license'],
    list: PATHS.software,
    item: PATHS.softwareItem,
    navKey: 'nav.software',
    titleKey: 'software.title',
    subtitleKey: 'software.subtitle',
    addKey: 'software.add',
    emptyKey: 'software.empty',
    emptyHintKey: 'software.emptyHint',
    searchKey: 'software.search',
    exportFile: 'phan-mem.xlsx',
  },
  domains: {
    key: 'domains',
    // Tên miền trước: nó là thứ người ta mua trước, chứng chỉ SSL đi theo nó.
    kinds: ['domain', 'ssl'],
    list: PATHS.domains,
    item: PATHS.domainItem,
    navKey: 'nav.domains',
    titleKey: 'softwareScreens.domains.title',
    subtitleKey: 'softwareScreens.domains.subtitle',
    addKey: 'softwareScreens.domains.add',
    emptyKey: 'softwareScreens.domains.empty',
    emptyHintKey: 'softwareScreens.domains.emptyHint',
    searchKey: 'softwareScreens.domains.search',
    exportFile: 'ten-mien-ssl.xlsx',
  },
  maintenance: {
    key: 'maintenance',
    kinds: ['maintenance'],
    list: PATHS.maintenance,
    item: PATHS.maintenanceItem,
    navKey: 'nav.maintenance',
    titleKey: 'softwareScreens.maintenance.title',
    subtitleKey: 'softwareScreens.maintenance.subtitle',
    addKey: 'softwareScreens.maintenance.add',
    emptyKey: 'softwareScreens.maintenance.empty',
    emptyHintKey: 'softwareScreens.maintenance.emptyHint',
    searchKey: 'softwareScreens.maintenance.search',
    exportFile: 'hop-dong-bao-tri.xlsx',
  },
  services: {
    key: 'services',
    kinds: ['other'],
    list: PATHS.services,
    item: PATHS.serviceItem,
    navKey: 'nav.services',
    titleKey: 'softwareScreens.services.title',
    subtitleKey: 'softwareScreens.services.subtitle',
    addKey: 'softwareScreens.services.add',
    emptyKey: 'softwareScreens.services.empty',
    emptyHintKey: 'softwareScreens.services.emptyHint',
    searchKey: 'softwareScreens.services.search',
    exportFile: 'dich-vu-co-han.xlsx',
  },
};

/** Thứ tự màn trên menu (Q-22). */
export const SOFTWARE_SCREEN_KEYS = Object.keys(SOFTWARE_SCREENS) as SoftwareScreenKey[];

/** Màn của một loại. Loại lạ (dữ liệu hỏng) rơi về Phần mềm thay vì ném lỗi giữa lúc vẽ link. */
export function screenOfKind(kind: string): SoftwareScreenSpec {
  return (
    Object.values(SOFTWARE_SCREENS).find((screen) =>
      screen.kinds.includes(kind as SoftwareKind),
    ) ?? SOFTWARE_SCREENS.software
  );
}

/** Link tới hồ sơ khi đã biết loại — đi thẳng vào màn của nó, menu sáng đúng ngay từ đầu. */
export function softwareItemPath(kind: string, id: string): string {
  return screenOfKind(kind).item(id);
}

/**
 * `?kind=` gửi lên API: loại người dùng chọn nếu nó thuộc màn, không thì mọi loại của màn.
 * URL gõ tay `/domains?kind=license` không được kéo license sang màn Tên miền.
 */
export function softwareKindsParam(screen: SoftwareScreenSpec, picked: string): string {
  return screen.kinds.includes(picked as SoftwareKind) ? picked : screen.kinds.join(',');
}

/**
 * `/software?kind=ssl` (link ghim / gửi qua chat từ trước khi tách màn) → đường mới, giữ các bộ
 * lọc còn lại. Màn chỉ có một loại thì bỏ `kind` khỏi URL — ở đó nó không còn là bộ lọc nữa.
 * `null` = ở lại `/software`.
 */
export function legacySoftwareListRedirect(search: string): string | null {
  const params = new URLSearchParams(search);
  const kind = params.get('kind') ?? '';
  if (!SOFTWARE_KINDS.includes(kind as SoftwareKind)) return null;
  const screen = screenOfKind(kind);
  if (screen.key === 'software') return null;
  if (screen.kinds.length === 1) params.delete('kind');
  const rest = params.toString();
  return rest ? `${screen.list}?${rest}` : screen.list;
}
