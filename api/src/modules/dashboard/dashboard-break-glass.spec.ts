import { DashboardService } from './dashboard.service';
import type { ExpiryApiService } from '../expiry/expiry.api';
import type { ApprovalsApiService } from '../approvals/approvals.api';
import type { DevicesApiService } from '../devices/devices.api';
import type { IpamApiService } from '../ipam/ipam.api';
import type { VaultApiService } from '../vault/vault.api';
import type { DisposalApiService } from '../disposal/disposal.api';
import type { SystemConfigService } from '../config-sys/system-config.service';

/**
 * BE-10 — khối break-glass hỏi đúng "tuần qua, 8 dòng" và để SQL lọc; `total` là con số SQL đếm,
 * không phải độ dài của trang đã cắt.
 */
describe('Khối break-glass của trang chủ', () => {
  it('xin since = 7 ngày trước, limit 8, và dùng total của máy chủ', async () => {
    const asked: { filters: { kind?: string; since?: Date }; paging: { limit: number } }[] = [];
    const approvals = {
      page: (filters: { kind?: string; since?: Date }, paging: { limit: number; offset: number }) => {
        asked.push({ filters, paging });
        return Promise.resolve({ items: [], total: 42 });
      },
      list: () => Promise.reject(new Error('không được tải cả lịch sử')),
    } as unknown as ApprovalsApiService;
    const empty = () => Promise.resolve([]);
    const service = new DashboardService(
      {
        list: () =>
          Promise.resolve({ items: [], total: 0, summary: {}, failedKinds: [] }),
      } as unknown as ExpiryApiService,
      approvals,
      { getById: () => Promise.resolve(null) } as unknown as DevicesApiService,
      { listSubnets: empty } as unknown as IpamApiService,
      { listOwners: empty } as unknown as VaultApiService,
      { list: empty } as unknown as DisposalApiService,
      { getNumber: () => Promise.resolve(80) } as unknown as SystemConfigService,
    );

    const before = Date.now();
    const board = await service.build({ email: 'sep@pmh.com.vn', role: 'sa' });

    expect(board.breakGlass).toMatchObject({ available: true, total: 42 });
    expect(asked).toHaveLength(1);
    expect(asked[0].filters.kind).toBe('break_glass');
    expect(asked[0].paging.limit).toBe(8);
    const sinceMs = asked[0].filters.since?.getTime() ?? 0;
    expect(Math.abs(before - 7 * 86_400_000 - sinceMs)).toBeLessThan(60_000);
  });
});
