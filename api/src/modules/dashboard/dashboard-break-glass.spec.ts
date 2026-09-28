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
      { describe: () => Promise.resolve(null) } as unknown as ApprovalKindRegistry,
      { listSubnets: empty } as unknown as IpamApiService,
      { listOwners: empty } as unknown as VaultApiService,
      { list: empty } as unknown as DisposalApiService,
      { getNumber: () => Promise.resolve(80) } as unknown as SystemConfigService,
      { namesByEmails: () => Promise.resolve(new Map()) } as unknown as UsersApiService,
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

/**
 * DASH-006/007 — một dòng break-glass phải đọc được mà không phải đi tra: TÊN người xin (không
 * phải email), đối tượng gọi bằng mã · tên cho MỌI loại chủ thể (không phải 8 ký tự uuid), tên
 * người quyết, và cờ còn hiệu lực do server tính (AD-6) để web tô đúng màu.
 */
describe('Dòng break-glass của trang chủ', () => {
  const now = Date.now();
  const record = (patch: Record<string, unknown>) => ({
    id: 'a1',
    kind: 'break_glass',
    state: 'approved',
    requester: 'lan@pmh.com.vn',
    subjectType: 'service_account',
    subjectId: '77a9ea7f-0000-4000-8000-000000000001',
    reason: 'sự cố VPN',
    payload: { hours: 2 },
    decidedBy: 'sep@pmh.com.vn',
    decidedAt: new Date(now - 60_000),
    decisionNote: null,
    expiresAt: new Date(now + 3_600_000),
    createdAt: new Date(now - 120_000),
    updatedAt: new Date(now - 60_000),
    active: true,
    ...patch,
  });

  async function boardWith(rows: ReturnType<typeof record>[], described: Record<string, string | null>) {
    const service = new DashboardService(
      { list: () => Promise.resolve({ items: [], total: 0, summary: {}, failedKinds: [] }) } as unknown as ExpiryApiService,
      { page: () => Promise.resolve({ items: rows, total: rows.length }) } as unknown as ApprovalsApiService,
      {
        describe: (_kind: string, _type: string, id: string) =>
          Promise.resolve(described[id] ? { code: 'x', label: described[id], path: '/x' } : null),
      } as unknown as ApprovalKindRegistry,
      { listSubnets: () => Promise.resolve([]) } as unknown as IpamApiService,
      { listOwners: () => Promise.resolve([]) } as unknown as VaultApiService,
      { list: () => Promise.resolve([]) } as unknown as DisposalApiService,
      { getNumber: () => Promise.resolve(80) } as unknown as SystemConfigService,
      {
        namesByEmails: () =>
          Promise.resolve(new Map([['lan@pmh.com.vn', 'Nguyễn Thị Lan'], ['sep@pmh.com.vn', 'Trần Sếp']])),
      } as unknown as UsersApiService,
    );
    return service.build({ email: 'sep@pmh.com.vn', role: 'sa' });
  }

  it('tên người xin/người quyết, nhãn đối tượng cho cả loại KHÔNG phải thiết bị, cờ hiệu lực', async () => {
    const board = await boardWith([record({})], {
      '77a9ea7f-0000-4000-8000-000000000001': 'VPN-E2E · VPN chi nhánh',
    });
    expect(board.breakGlass.items[0]).toMatchObject({
      requesterName: 'Nguyễn Thị Lan',
      decidedByName: 'Trần Sếp',
      subjectLabel: 'VPN-E2E · VPN chi nhánh',
      active: true,
    });
  });

  it('hồ sơ đã xoá → nhãn null (web nói "hồ sơ đã bị xoá"), KHÔNG lùi về mảnh uuid', async () => {
    const board = await boardWith([record({})], {});
    expect(board.breakGlass.items[0].subjectLabel).toBeNull();
  });
});

describe('Khối hạn và khối dải mạng mang thêm số để web phân loại', () => {
  it('khối hạn tách riêng số QUÁ HẠN; khối dải mạng nói ngưỡng đang áp', async () => {
    const service = new DashboardService(
      {
        list: (o: { state?: string } = {}) =>
          Promise.resolve({
            items: [],
            total: o.state === 'expired' ? 3 : 16,
            summary: {},
            failedKinds: [],
          }),
      } as unknown as ExpiryApiService,
      { page: () => Promise.resolve({ items: [], total: 0 }) } as unknown as ApprovalsApiService,
      { describe: () => Promise.resolve(null) } as unknown as ApprovalKindRegistry,
      { listSubnets: () => Promise.resolve([]) } as unknown as IpamApiService,
      { listOwners: () => Promise.resolve([]) } as unknown as VaultApiService,
      { list: () => Promise.resolve([]) } as unknown as DisposalApiService,
      { getNumber: () => Promise.resolve(90) } as unknown as SystemConfigService,
      { namesByEmails: () => Promise.resolve(new Map()) } as unknown as UsersApiService,
    );
    const board = await service.build({ email: 'sep@pmh.com.vn', role: 'admin' });
    expect(board.expiring).toMatchObject({ total: 19, overdueTotal: 3 });
    expect(board.subnetLoad.thresholdPercent).toBe(90);
  });
});

