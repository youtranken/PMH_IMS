import { DashboardService } from './dashboard.service';
import type { ExpiryApiService } from '../expiry/expiry.api';
import type { ApprovalsApiService } from '../approvals/approvals.api';
import type { DevicesApiService } from '../devices/devices.api';
import type { IpamApiService } from '../ipam/ipam.api';
import type { VaultApiService } from '../vault/vault.api';
import type { DisposalApiService } from '../disposal/disposal.api';
import type { SystemConfigService } from '../config-sys/system-config.service';

function row(id: string, daysLeft: number) {
  return { id, label: id, kind: 'ssl', start: null, end: `d${daysLeft}`, link: `/x/${id}`, daysLeft };
}

function buildService(failedKinds: string[]): DashboardService {
  const expiry = {
    list: () =>
      Promise.resolve({
        items: [row('ssl-1', 2)],
        total: 1,
        summary: { expired: 0, critical: 1, warning: 0 },
        failedKinds,
      }),
  } as unknown as ExpiryApiService;
  const empty = () => Promise.resolve([]);
  return new DashboardService(
    expiry,
    { list: empty } as unknown as ApprovalsApiService,
    { getById: () => Promise.resolve(null) } as unknown as DevicesApiService,
    { listSubnets: empty } as unknown as IpamApiService,
    { listOwners: empty } as unknown as VaultApiService,
    { list: empty } as unknown as DisposalApiService,
    { getNumber: () => Promise.resolve(80) } as unknown as SystemConfigService,
  );
}

/**
 * BE-01 — khối "sắp hết hạn" thiếu phần của một nguồn hỏng mà vẫn hiện như đủ thì sếp đọc nó
 * là "không có gì khác". Báo `available: false` để trang nói thẳng khối này đang không đọc được.
 */
describe('Khối "sắp hết hạn" khi một nguồn hạn lỗi', () => {
  it.each([
    [[], true],
    [['ssl'], false],
  ])('nguồn lỗi %j → available = %s', async (failed, available) => {
    const board = await buildService(failed).build({ email: 'sep@pmh.com.vn', role: 'admin' });
    expect(board.expiring.available).toBe(available);
  });
});
