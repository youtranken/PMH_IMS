import { FEATURE_TICKS, type FeatureTick } from '@/lib/features';
import type { FeatureGroup } from '@/ui/use-feature-groups';

/**
 * Hàng của bảng Nhóm quyền (Q-31), đúng thứ tự mockup đã duyệt. Nhãn dùng lại khóa `nav.*`: tên
 * trên bảng phải là tên SA thấy trên menu.
 */
export const FEATURE_ROWS: { tick: FeatureTick; labelKey: string; indent: boolean }[] = [
  { tick: 'overview', labelKey: 'nav.groupOverview', indent: false },
  { tick: 'assets', labelKey: 'nav.groupAssets', indent: false },
  { tick: 'network', labelKey: 'nav.groupNetwork', indent: false },
  { tick: 'iso_0203', labelKey: 'nav.isoBackup', indent: true },
  { tick: 'iso_0206', labelKey: 'nav.isoIncidents', indent: true },
  { tick: 'iso_0208', labelKey: 'nav.isoAntivirus', indent: true },
  { tick: 'break_glass', labelKey: 'nav.approvalsMine', indent: false },
];

type Drafts = Record<string, string[]>;

const sameTicks = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((tick) => b.includes(tick));

/** Đảo một ô. Nháp chỉ giữ nhóm KHÁC bản đã lưu, để "Đã đổi N nhóm" đếm đúng. */
export function toggleTick(groups: readonly FeatureGroup[], drafts: Drafts, groupId: string, tick: FeatureTick): Drafts {
  const saved = groups.find((group) => group.id === groupId)?.features ?? [];
  const current = drafts[groupId] ?? saved;
  const next = FEATURE_TICKS.filter((key) => (key === tick ? !current.includes(key) : current.includes(key)));
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
