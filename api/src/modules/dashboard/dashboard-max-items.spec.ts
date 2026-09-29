import { DashboardService } from './dashboard.service';
import type { ExpiryApiService } from '../expiry/expiry.api';
import type { ApprovalsApiService } from '../approvals/approvals.api';
import type { ApprovalKindRegistry } from '../../common/approvals/approvals-registry';
import type { UsersApiService } from '../users/users.api';
import type { IpamApiService } from '../ipam/ipam.api';
import type { VaultApiService } from '../vault/vault.api';
import type { DisposalApiService } from '../disposal/disposal.api';
import type { SystemConfigService } from '../config-sys/system-config.service';

/**
 * BE-20 · số dòng tối đa mỗi khối của trang chủ đọc từ `dashboard.max_items` (AD-11): đổi hàng
 * cấu hình là mọi khối cắt theo, còn `total` vẫn đếm đủ để người đọc biết còn phải bấm xem tiếp.
 */

function upcoming(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `ssl-${i}`,
    label: `ssl-${i}`,
    kind: 'ssl',
    start: null,
    end: `d${i}`,
    link: null,
    daysLeft: i,
  }));
}

function subnets(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `s-${i}`,
    name: `Dải ${i}`,
    cidr: `10.0.${i}.0/24`,
    vlan: null,
    used: 250,
    total: 254,
    free: 4,
    percent: 98,
  }));
}

function buildService(maxItems: number, pageLimits: number[]): DashboardService {
  const rows = upcoming(20);
  const expiry = {
    list: (options: { state?: string; limit?: number }) => {
      const all = options.state === 'expired' ? [] : rows;
      return Promise.resolve({
        items: all.slice(0, options.limit ?? all.length),
        total: all.length,
        summary: { expired: 0, critical: 0, warning: 0 },
        failedKinds: [],
      });
    },
  } as unknown as ExpiryApiService;
  const numbers: Record<string, number> = {
    dashboardMaxItems: maxItems,
    dashboardSubnetFullPercent: 80,
    dashboardSecretStaleDays: 180,
  };
  return new DashboardService(
    expiry,
    {
      page: (_filter: unknown, paging: { limit: number }) => {
        pageLimits.push(paging.limit);
        return Promise.resolve({ items: [], total: 0 });
      },
    } as unknown as ApprovalsApiService,
    { describe: () => Promise.resolve(null) } as unknown as ApprovalKindRegistry,
    { listSubnets: () => Promise.resolve(subnets(12)) } as unknown as IpamApiService,
    { listOwners: () => Promise.resolve([]) } as unknown as VaultApiService,
    { list: () => Promise.resolve([]) } as unknown as DisposalApiService,
    { getNumber: (name: string) => Promise.resolve(numbers[name]) } as unknown as SystemConfigService,
    { namesByEmails: () => Promise.resolve(new Map()) } as unknown as UsersApiService,
  );
}

describe('Trang chủ — số dòng mỗi khối theo system_config', () => {
  it.each([8, 3])('dashboard.max_items = %i → mọi khối cắt đúng số đó, total đếm đủ', async (max) => {
    const pageLimits: number[] = [];
    const board = await buildService(max, pageLimits).build({ email: 'sep@pmh.com.vn', role: 'admin' });

    expect(board.expiring.items).toHaveLength(max);
    expect(board.expiring.total).toBe(20);
    expect(board.subnetLoad.items).toHaveLength(max);
    expect(board.subnetLoad.total).toBe(12);
    expect(pageLimits).toEqual([max]);
  });
});
