import { FEATURE_TICKS, type FeatureTick } from '@/lib/features';
import type { FeatureGroup } from '@/ui/use-feature-groups';

/* `FEATURE_ROWS` dời sang `lib/features` (bảng Nhóm quyền và Hồ sơ của tôi cùng dùng, AD-15). */
export { FEATURE_ROWS } from '@/lib/features';

type Drafts = Record<string, string[]>;

const sameTicks = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((tick) => b.includes(tick));

/**
 * Ô 0206 bị khóa khi nhóm còn 0203 / 0208 (Q-31): ô ✗ của hai phiếu đó cần phiếu sự cố thì kỳ mới
 * chốt được. API cũng tự thêm 0206, đây chỉ để bảng không cho bỏ một ô mà API sẽ tick lại.
 */
export function lockedBy(ticks: readonly string[], tick: FeatureTick): boolean {
  return tick === 'iso_0206' && (ticks.includes('iso_0203') || ticks.includes('iso_0208'));
}

/** Đảo một ô. Nháp chỉ giữ nhóm KHÁC bản đã lưu, để "Đã đổi N nhóm" đếm đúng. */
export function toggleTick(groups: readonly FeatureGroup[], drafts: Drafts, groupId: string, tick: FeatureTick): Drafts {
  const saved = groups.find((group) => group.id === groupId)?.features ?? [];
  const current = drafts[groupId] ?? saved;
  const flipped = FEATURE_TICKS.filter((key) => (key === tick ? !current.includes(key) : current.includes(key)));
  const next = FEATURE_TICKS.filter((key) => flipped.includes(key) || lockedBy(flipped, key));
  const rest = { ...drafts };
  delete rest[groupId];
  return sameTicks(next, saved) ? rest : { ...rest, [groupId]: next };
}

export function changedGroups(
  groups: readonly FeatureGroup[],
  drafts: Drafts,
): { id: string; name: string; features: string[]; empty: boolean }[] {
  return groups
    .filter((group) => drafts[group.id] && !sameTicks(drafts[group.id], group.features))
    .map((group) => ({ id: group.id, name: group.name, features: drafts[group.id], empty: drafts[group.id].length === 0 }));
}
