import { DeviceTimelineRegistry, type DeviceTimelineEntry } from './device-timeline.registry';

const entry = (source: string, at: string): DeviceTimelineEntry => ({
  id: `${source}-${at}`,
  source,
  action: 'x',
  at: new Date(at),
  actor: 'a@pmh.com.vn',
  subject: 's',
  link: null,
});

describe('DeviceTimelineRegistry — dòng thời gian hợp nhất của thiết bị', () => {
  it('gộp mọi nguồn, mới nhất lên đầu, cắt ở limit sau khi gộp', async () => {
    const registry = new DeviceTimelineRegistry();
    registry.register({
      source: 'ipam',
      timelineFor: () => Promise.resolve([entry('ipam', '2026-09-03'), entry('ipam', '2026-09-01')]),
    });
    registry.register({
      source: 'software',
      timelineFor: () => Promise.resolve([entry('software', '2026-09-02')]),
    });
    const result = await registry.timelineFor('d1', 2);
    expect(result.items.map((row) => row.id)).toEqual(['ipam-2026-09-03', 'software-2026-09-02']);
    expect(result.failedSources).toEqual([]);
  });

  it('một nguồn lỗi không làm sập cả dòng thời gian, và được nêu tên', async () => {
    const registry = new DeviceTimelineRegistry();
    registry.register({ source: 'ipam', timelineFor: () => Promise.reject(new Error('sập')) });
    registry.register({
      source: 'software',
      timelineFor: () => Promise.resolve([entry('software', '2026-09-02')]),
    });
    const result = await registry.timelineFor('d1', 10);
    expect(result.items).toHaveLength(1);
    expect(result.failedSources).toEqual(['ipam']);
  });

  it('đăng ký hai lần cùng nguồn không nhân đôi dòng', async () => {
    const registry = new DeviceTimelineRegistry();
    const provider = {
      source: 'ipam',
      timelineFor: () => Promise.resolve([entry('ipam', '2026-09-01')]),
    };
    registry.register(provider);
    registry.register(provider);
    expect((await registry.timelineFor('d1', 10)).items).toHaveLength(1);
  });
});
