import type { TFunction } from 'i18next';
import type { HistoryEntry } from '@/ui/history-panel';

/** Một sự kiện của module khác về máy này — hình dạng `GET /devices/:id/timeline`. */
export interface TimelineItem {
  id: string;
  source: string;
  action: string;
  at: string;
  actor: string;
  subject: string;
  link: string | null;
}

export interface DeviceTimeline {
  items: TimelineItem[];
  failedSources: string[];
}

/** Chip lọc: '' = tất cả, `profile` = lịch sử hồ sơ của chính máy, còn lại là nguồn API. */
export type TimelineFilter = '' | 'profile' | 'ipam' | 'software';

export const TIMELINE_FILTERS: TimelineFilter[] = ['', 'profile', 'ipam', 'software'];

export const TIMELINE_FILTER_KEY: Record<TimelineFilter, string> = {
  '': 'devices.timelineAll',
  profile: 'devices.timelineProfile',
  ipam: 'devices.timelineIp',
  software: 'devices.timelineLicense',
};

const ACTION_KEY: Record<string, string> = {
  'ip-assigned': 'devices.timelineIpAssigned',
  'ip-released': 'devices.timelineIpReleased',
  'license-assigned': 'devices.timelineLicenseAssigned',
  'license-released': 'devices.timelineLicenseReleased',
};

/**
 * Lịch sử hồ sơ + sự kiện IP/license của máy thành MỘT dòng thời gian, mới nhất lên đầu
 * (DEV-086) — "máy này từng dùng key nào, IP nào" đọc ở một chỗ thay vì ba màn.
 *
 * Hàm thuần, nhận `t` bằng tham số để test bảng dữ liệu không cần dựng React.
 */
export function mergeDeviceTimeline(
  profile: HistoryEntry[],
  others: TimelineItem[],
  filter: TimelineFilter,
  t: TFunction,
): HistoryEntry[] {
  const fromOthers: (HistoryEntry & { source: string })[] = others.map((item) => ({
    id: item.id,
    at: item.at,
    actor: item.actor,
    source: item.source,
    action: ACTION_KEY[item.action]
      ? t(ACTION_KEY[item.action], { subject: item.subject })
      : `${item.action} · ${item.subject}`,
  }));
  const fromProfile = profile.map((entry) => ({ ...entry, source: 'profile' }));
  return [...fromProfile, ...fromOthers]
    .filter((entry) => !filter || entry.source === filter)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map(({ source: _source, ...entry }) => entry);
}
