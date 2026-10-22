import { PATHS } from './routes';

/**
 * Nhóm quyền của Thành viên (Q-31) phía web. API trả tập ĐÃ SUY RA trong `me.features`
 * (`api/src/common/features.ts`), nên web chỉ hỏi "có không", không tự suy.
 * Web ẩn cho gọn; hàng rào thật là FeatureGuard ở API.
 */
export const FEATURE_TICKS = [
  'overview',
  'assets',
  'network',
  'iso_0203',
  'iso_0206',
  'iso_0208',
  'break_glass',
] as const;

export type FeatureTick = (typeof FEATURE_TICKS)[number];

/**
 * Các mục tick của nhóm quyền (Q-31), đúng thứ tự mockup đã duyệt — hàng của bảng Nhóm quyền và
 * danh sách "Quyền của tôi" ở Hồ sơ. Nhãn dùng lại khóa `nav.*`: tên phải là tên thấy trên menu.
 */
export const FEATURE_ROWS: { tick: FeatureTick; labelKey: string; underIso: boolean }[] = [
  { tick: 'overview', labelKey: 'nav.groupOverview', underIso: false },
  { tick: 'assets', labelKey: 'nav.groupAssets', underIso: false },
  { tick: 'network', labelKey: 'nav.groupNetwork', underIso: false },
  { tick: 'iso_0203', labelKey: 'nav.isoBackup', underIso: true },
  { tick: 'iso_0206', labelKey: 'nav.isoIncidents', underIso: true },
  { tick: 'iso_0208', labelKey: 'nav.isoAntivirus', underIso: true },
  { tick: 'break_glass', labelKey: 'nav.approvalsMine', underIso: false },
];
export type Feature = FeatureTick | 'expiry' | 'iso';

/** Có ít nhất MỘT trong `required`. `features: null` = không bị giới hạn; chưa có `me` = không. */
export function canSee(me: { features: readonly string[] | null } | null | undefined, ...required: Feature[]): boolean {
  if (!me) return false;
  const features = me.features ?? null;
  return features === null || required.length === 0 || required.some((feature) => features.includes(feature));
}

/**
 * Màn → mảng. Khớp đúng đường hoặc tiền tố `<đường>/` (trang chi tiết đội mảng của danh sách).
 * Đường không có ở đây (Hồ sơ, quản trị, két) không thuộc mảng nào.
 */
const ROUTE_FEATURES: Record<string, Feature[]> = {
  [PATHS.dashboard]: ['overview'],
  [PATHS.expiry]: ['expiry'],
  [PATHS.adminCatalog]: ['assets'],
  [PATHS.devices]: ['assets'],
  [PATHS.software]: ['assets'],
  [PATHS.domains]: ['assets'],
  [PATHS.maintenance]: ['assets'],
  [PATHS.services]: ['assets'],
  [PATHS.ispLines]: ['assets'],
  [PATHS.serviceAccounts]: ['assets'],
  [PATHS.disposal]: ['assets'],
  [PATHS.ipAddresses]: ['network'],
  [PATHS.nat]: ['network'],
  [PATHS.diagrams]: ['network'],
  [PATHS.isoBackup]: ['iso_0203'],
  [PATHS.isoAntivirus]: ['iso_0208'],
  [PATHS.isoIncidents]: ['iso_0206'],
  [PATHS.isoPeriods]: ['iso'],
  // Danh mục phiếu chỉ có job 0203 và bộ phận 0208.
  [PATHS.isoCatalog]: ['iso_0203', 'iso_0208'],
  [PATHS.approvals]: ['break_glass'],
};

export function featureOfPath(pathname: string): Feature[] | null {
  const exact = ROUTE_FEATURES[pathname];
  if (exact) return exact;
  const prefix = Object.keys(ROUTE_FEATURES)
    .filter((path) => path !== '/' && pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? ROUTE_FEATURES[prefix] : null;
}

/** Người này mở được màn đó không (theo nhóm quyền; vai do `canSeeRoute` lo). */
export function canSeePath(me: { features: readonly string[] | null } | null | undefined, pathname: string): boolean {
  const required = featureOfPath(pathname);
  return required === null || canSee(me, ...required);
}
