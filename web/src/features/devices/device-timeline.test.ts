import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import type { HistoryEntry } from '@/ui/history-panel';
import { mergeDeviceTimeline, type TimelineItem } from './device-timeline';

/** `t` thật của app: khoá gõ sai hay quên khai trong vi.ts là đỏ ở đây (DEV-086). */
const t = i18n.t;

const PROFILE: HistoryEntry[] = [
  { id: 'h2', at: '2026-09-05T01:00:00Z', actor: 'a@pmh.com.vn', action: 'Sửa hồ sơ' },
  { id: 'h1', at: '2026-09-01T01:00:00Z', actor: 'a@pmh.com.vn', action: 'Tạo hồ sơ' },
];
const OTHERS: TimelineItem[] = [
  {
    id: 'ip1',
    source: 'ipam',
    action: 'ip-assigned',
    at: '2026-09-03T01:00:00Z',
    actor: 'b@pmh.com.vn',
    subject: '10.0.0.5',
    link: '/ip-addresses/x?ip=10.0.0.5',
  },
  {
    id: 'sw1',
    source: 'software',
    action: 'license-released',
    at: '2026-09-06T01:00:00Z',
    actor: 'c@pmh.com.vn',
    subject: 'LIC-01',
    link: '/software/y',
  },
];

describe('mergeDeviceTimeline — lịch sử hồ sơ + sự kiện module khác, một dòng thời gian', () => {
  it('gộp và xếp mới nhất lên đầu, câu chữ tiếng Việt nêu đối tượng', () => {
    const rows = mergeDeviceTimeline(PROFILE, OTHERS, '', t);
    expect(rows.map((row) => row.id)).toEqual(['sw1', 'h2', 'ip1', 'h1']);
    expect(rows[0].action).toBe('Gỡ license LIC-01 khỏi máy');
    expect(rows[2].action).toBe('Cấp IP 10.0.0.5 cho máy');
  });

  it.each([
    ['profile', ['h2', 'h1']],
    ['ipam', ['ip1']],
    ['software', ['sw1']],
  ] as const)('lọc %s', (filter, ids) => {
    expect(mergeDeviceTimeline(PROFILE, OTHERS, filter, t).map((row) => row.id)).toEqual(ids);
  });

  it('hành động lạ vẫn hiện (in nguyên mã) chứ không biến mất', () => {
    const rows = mergeDeviceTimeline([], [{ ...OTHERS[0], action: 'ip-moved' }], '', t);
    expect(rows[0].action).toContain('ip-moved');
  });
});
