/**
 * Nhóm quyền của Thành viên (Q-31). Bản này và `web/src/lib/features.ts` phải cho cùng kết quả:
 * hai bên không import được nhau, nên mỗi bên giữ một bài kiểm bảng với cùng các dòng.
 */

/** Bảy ô tick SA lưu vào nhóm, đúng thứ tự hàng trên màn Nhóm quyền. */
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
 * Khóa route có thể đòi. `expiry` và `iso` không lưu được vào nhóm: chúng SUY RA từ ô tick, để
 * "Sắp hết hạn" (toàn dữ liệu Tài sản) và "Kỳ phiếu / Danh mục phiếu" (chung ba phiếu) không bao
 * giờ hiện khi thiếu thứ chúng dẫn tới.
 */
export type Feature = FeatureTick | 'expiry' | 'iso';

export const ISO_FORM_FEATURES = ['iso_0203', 'iso_0206', 'iso_0208'] as const;

export function isFeatureTick(key: string): key is FeatureTick {
  return (FEATURE_TICKS as readonly string[]).includes(key);
}

/**
 * Ô 0203 / 0208 kéo theo 0206: ô ✗ trên hai phiếu đó phải có phiếu sự cố thì kỳ mới chốt được.
 * Áp cả khi lưu nhóm lẫn khi tính quyền, để nhóm ghi bằng đường khác vẫn không thiếu 0206.
 */
export function withImpliedTicks(ticks: readonly string[]): FeatureTick[] {
  const pulls0206 = ticks.includes('iso_0203') || ticks.includes('iso_0208');
  return FEATURE_TICKS.filter((tick) => ticks.includes(tick) || (tick === 'iso_0206' && pulls0206));
}

/**
 * Tập tính năng một người được dùng. `null` = không bị giới hạn: SA/Admin luôn đủ, Member chưa
 * gán nhóm thấy như trước Q-31.
 */
export function effectiveFeatures(
  role: string,
  groupTicks: readonly string[] | null,
): Feature[] | null {
  if (role !== 'member' || groupTicks === null) return null;
  const ticks: Feature[] = withImpliedTicks(groupTicks);
  if (ticks.includes('overview') && ticks.includes('assets')) ticks.push('expiry');
  if (ISO_FORM_FEATURES.some((form) => ticks.includes(form))) ticks.push('iso');
  return ticks;
}

/** Câu 403 khi nhóm quyền ẩn mảng — một câu cho mọi nơi chặn, để web hiện đúng một kiểu. */
export const FEATURE_HIDDEN = { code: 'FEATURE_HIDDEN', message: 'Nhóm quyền của bạn không có mục này.' } as const;

/** Có ít nhất MỘT trong các tính năng `required`. */
export function hasFeature(
  features: readonly string[] | null,
  required: readonly Feature[],
): boolean {
  return features === null || required.some((feature) => features.includes(feature));
}

/** Một người đang giữ việc của một mảng — hiện chỉ có người phụ trách phiếu ISO 0203 / 0208. */
export interface FeatureHolding {
  userId: string;
  feature: FeatureTick;
  /** Tên việc cho câu báo lỗi, vd "phụ trách phiếu 0208". */
  label: string;
}

/**
 * Q-31: người phụ trách phải thấy phiếu mình phụ trách. Trả những việc mà nhóm MỚI của người giữ
 * không có ô tick. `ticksByUser` chỉ chứa người đang bị đổi; `null` = đủ quyền.
 */
export function holdingConflicts(
  holdings: readonly FeatureHolding[],
  ticksByUser: ReadonlyMap<string, readonly string[] | null>,
): FeatureHolding[] {
  return holdings.filter((holding) => {
    if (!ticksByUser.has(holding.userId)) return false;
    const ticks = ticksByUser.get(holding.userId) ?? null;
    return ticks !== null && !ticks.includes(holding.feature);
  });
}
