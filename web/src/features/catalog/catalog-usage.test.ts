import { describe, expect, it } from 'vitest';
import type { CatalogRow } from '@/lib/catalog-types';
import { deviceUsage, usageLinks, usageTotal } from './catalog-usage';

const row = (usage: { kind: string; count: number }[], extra: Record<string, unknown> = {}) =>
  ({ id: 'x-1', code: 'E2E', name: 'E2E', active: true, usage, ...extra }) as unknown as CatalogRow;

describe('catalog-usage — số "đang dùng ở" và link lọc sẵn', () => {
  it.each([
    ['site', 'device', '/devices?siteId=x-1'],
    ['site', 'cabinet', '/admin/catalog?tab=cabinet&siteId=x-1'],
    ['site', 'isp_line', '/isp-lines?siteId=x-1&status=all'],
    ['device_type', 'device', '/devices?deviceTypeId=x-1'],
    ['vendor', 'software', '/software?vendorId=x-1&status=all'],
    ['isp_provider', 'isp_line', '/isp-lines?providerId=x-1&status=all'],
    ['vendor', 'device', null],
    ['site', 'subnet', null],
    ['department', 'service_account', null],
  ])('%s · %s → %s', (entity, kind, href) => {
    const links = usageLinks(entity as never, row([{ kind, count: 2 }]));
    expect(links).toEqual([{ kind, count: 2, href }]);
  });

  it('tủ mạng: link thiết bị mang cả site lẫn tủ (màn Thiết bị lọc tủ trong site)', () => {
    const links = usageLinks('cabinet', row([{ kind: 'device', count: 1 }], { siteId: 's-1' }));
    expect(links[0].href).toBe('/devices?siteId=s-1&cabinetId=x-1');
  });

  it('bỏ số 0; không có `usage` (API cũ, sổ đếm hỏng) thì coi như chưa biết, tổng 0', () => {
    expect(usageLinks('site', row([{ kind: 'device', count: 0 }]))).toEqual([]);
    const bare = { id: 'x', code: 'E2E', name: 'E2E', active: true } as unknown as CatalogRow;
    expect(usageTotal(bare)).toBe(0);
    expect(deviceUsage(bare)).toBe(0);
  });

  it('tổng cộng mọi loại; số thiết bị lấy riêng', () => {
    const r = row([
      { kind: 'device', count: 3 },
      { kind: 'software', count: 2 },
    ]);
    expect(usageTotal(r)).toBe(5);
    expect(deviceUsage(r)).toBe(3);
  });
});
