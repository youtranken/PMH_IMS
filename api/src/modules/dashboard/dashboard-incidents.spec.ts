import { DashboardService } from './dashboard.service';
import type { ExpiryApiService } from '../expiry/expiry.api';
import type { ApprovalsApiService } from '../approvals/approvals.api';
import type { ApprovalKindRegistry } from '../../common/approvals/approvals-registry';
import type { UsersApiService } from '../users/users.api';
import type { IpamApiService } from '../ipam/ipam.api';
import type { VaultApiService } from '../vault/vault.api';
import type { DisposalApiService } from '../disposal/disposal.api';
import type { IsoFormsApiService } from '../iso-forms/iso-forms.api';
import type { SystemConfigService } from '../config-sys/system-config.service';

/**
 * FR-027 ②: khối "Sự cố tuần qua" đọc phiếu 0206 qua `iso-forms.api` (AD-2). Trước khi có 0206
 * khối này nói "chưa theo dõi"; có rồi mà vẫn nói vậy thì sếp tưởng IMS không biết gì về sự cố.
 */

function buildService(iso: Partial<IsoFormsApiService>, maxItems = 2): DashboardService {
  const emptyPage = { items: [], total: 0, summary: { expired: 0, critical: 0, warning: 0 }, failedKinds: [] };
  return new DashboardService(
    { list: () => Promise.resolve(emptyPage) } as unknown as ExpiryApiService,
    { page: () => Promise.resolve({ items: [], total: 0 }) } as unknown as ApprovalsApiService,
    { describe: () => Promise.resolve(null) } as unknown as ApprovalKindRegistry,
    { listSubnets: () => Promise.resolve([]) } as unknown as IpamApiService,
    { listOwners: () => Promise.resolve([]) } as unknown as VaultApiService,
    { list: () => Promise.resolve([]) } as unknown as DisposalApiService,
    {
      getNumber: (name: string) =>
        Promise.resolve({ dashboardMaxItems: maxItems, dashboardSubnetFullPercent: 80, dashboardSecretStaleDays: 180 }[name]),
    } as unknown as SystemConfigService,
    { namesByEmails: () => Promise.resolve(new Map()) } as unknown as UsersApiService,
    iso as IsoFormsApiService,
  );
}

const incident = (code: string, day: number) => ({
  id: `id-${code}`,
  code,
  kind: 'backup' as const,
  severity: 'high' as const,
  status: 'resolved' as const,
  detectedAt: new Date(`2026-10-${String(day).padStart(2, '0')}T02:00:00Z`),
  description: `Sự cố ${code}`,
});

describe('Trang chủ — khối "Sự cố tuần qua" từ phiếu 0206', () => {
  it('có phiếu trong tuần → available, cắt theo dashboard.max_items, total đếm đủ', async () => {
    const asked: number[] = [];
    const board = await buildService({
      recentIncidents: (withinDays: number) => {
        asked.push(withinDays);
        return Promise.resolve([incident('0206-2026-003', 18), incident('0206-2026-002', 15), incident('0206-2026-001', 13)]);
      },
    }).build({ email: 'member@pmh.com.vn', role: 'member' });
    expect(asked).toEqual([7]);
    expect(board.incidents.available).toBe(true);
    expect(board.incidents.total).toBe(3);
    expect(board.incidents.items.map((i) => i.code)).toEqual(['0206-2026-003', '0206-2026-002']);
  });

  it('tuần qua không có phiếu → available với 0 dòng ("không có sự cố", khác "chưa theo dõi")', async () => {
    const board = await buildService({ recentIncidents: () => Promise.resolve([]) }).build({ email: 'a@pmh.com.vn', role: 'admin' });
    expect(board.incidents).toEqual({ available: true, items: [], total: 0 });
  });

  it('module phiếu lỗi → khối báo lỗi, không làm hỏng cả trang', async () => {
    const board = await buildService({ recentIncidents: () => Promise.reject(new Error('db')) }).build({ email: 'a@pmh.com.vn', role: 'admin' });
    expect(board.incidents.available).toBe(false);
    expect(board.expiring).toBeDefined();
  });
});
