import { natExportRows } from './nat-export';

/**
 * UX-E29: file xuất của Sổ NAT phải là ĐÚNG thứ đang bày trên màn — giao thức, "chỉ cổng nhạy
 * cảm", ba chip trạng thái và thứ tự. Luật y như `web/src/features/ipam/nat-buckets.ts` +
 * `nat-sensitive.ts` (màn lọc tại chỗ trên cả sổ, file lọc ở đây trên cùng tập).
 */
type Rule = Parameters<typeof natExportRows>[0][number] & { id: string };
const rule = (over: Partial<Rule>): Rule => ({
  id: 'r',
  deviceCode: 'RT-A',
  protocol: 'tcp' as const,
  externalFrom: 443,
  externalTo: 443,
  internalIp: '10.0.0.5',
  internalPort: 443,
  enabled: true,
  voidedAt: null as Date | null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

describe('natExportRows', () => {
  const OPEN = rule({ id: 'open' });
  const OFF = rule({ id: 'off', enabled: false, externalFrom: 8080, externalTo: 8080, internalPort: 80 });
  const VOID = rule({ id: 'void', voidedAt: new Date(), externalFrom: 22, externalTo: 22, internalPort: 22 });
  const UDP = rule({ id: 'udp', protocol: 'udp', externalFrom: 5060, externalTo: 5060, internalPort: 5060 });
  const ALL = [OFF, VOID, UDP, OPEN];

  it.each([
    ['mặc định màn: chỉ đang mở', { states: ['open'] }, ['open', 'udp']],
    ['bật cả tắt + đã gỡ', { states: ['open', 'off', 'voided'] }, ['void', 'open', 'udp', 'off']],
    ['giao thức udp', { states: ['open', 'off', 'voided'], protocol: 'udp' }, ['udp']],
    ['chỉ cổng nhạy cảm (22, 3389) — dải ngoài chứa cổng hoặc cổng trong trùng', { states: ['open', 'off', 'voided'], sensitivePorts: [22, 3389] }, ['void']],
    ['sắp mới nhất trước', { states: ['open', 'off'], sort: 'newest' }, ['open', 'udp', 'off']],
  ] as const)('%s', (_name, filter, ids) => {
    expect(natExportRows(ALL, filter).map((r) => r.id)).toEqual(ids);
  });

  it('dải cổng ngoài chứa cổng nhạy cảm thì là nhạy cảm', () => {
    const wide = rule({ id: 'wide', externalFrom: 3000, externalTo: 4000, internalPort: 9000 });
    expect(natExportRows([wide], { states: ['open'], sensitivePorts: [3389] }).map((r) => r.id)).toEqual(['wide']);
  });
});
