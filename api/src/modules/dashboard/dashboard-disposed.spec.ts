import { DashboardService } from './dashboard.service';
import type { ExpiryApiService } from '../expiry/expiry.api';
import type { ApprovalsApiService } from '../approvals/approvals.api';
import type { ApprovalKindRegistry } from '../../common/approvals/approvals-registry';
import type { UsersApiService } from '../users/users.api';
import type { IpamApiService } from '../ipam/ipam.api';
import type { VaultApiService } from '../vault/vault.api';
import { DisposalApiService } from '../disposal/disposal.api';
import type { IsoFormsApiService } from '../iso-forms/iso-forms.api';
import { DisposalService } from '../disposal/disposal.service';
import type { DevicesApiService } from '../devices/devices.api';
import type { SoftwareApiService } from '../software/software.api';
import type { ServiceAccountsApiService } from '../service-accounts/service-accounts.api';
import type { SystemConfigService } from '../config-sys/system-config.service';

/**
 * Khối "Vừa thanh lý" của trang chủ tính theo NGÀY VÀO KHO (lần chuyển sang ngừng dùng gần nhất
 * trong lịch sử), đúng như màn Kho thanh lý. Tính theo `updatedAt` thì máy thanh lý từ 2024, hôm
 * qua có người sửa ghi chú, hiện thành "vừa thanh lý". Đi qua `DisposalService` thật, chỉ giả các
 * module nguồn.
 */

const NOW = new Date('2026-10-19T03:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function buildService(): DashboardService {
  const retired = [
    // Thanh lý từ 2024, hôm qua sửa ghi chú → updatedAt mới, ngày vào kho cũ.
    { id: 'd-old', code: 'E2E-OLD', name: 'Máy cũ', deviceTypeName: 'PC', status: 'retired', updatedAt: daysAgo(1) },
    // Thanh lý thật trong tuần.
    { id: 'd-new', code: 'E2E-NEW', name: 'Máy mới bỏ', deviceTypeName: 'PC', status: 'retired', updatedAt: daysAgo(2) },
  ];
  const events = new Map([
    ['d-old', { at: new Date('2024-03-01T00:00:00Z'), by: 'a@pmh.com.vn', auto: false, reason: null }],
    ['d-new', { at: daysAgo(2), by: 'a@pmh.com.vn', auto: false, reason: null }],
  ]);
  const page = (items: unknown[]) => () => Promise.resolve({ items, total: items.length });
  const none = () => Promise.resolve([]);
  const noEvents = () => Promise.resolve(new Map());
  const devices = {
    listRetired: () => Promise.resolve(retired),
    retiredPage: page(retired),
    retirementEvents: () => Promise.resolve(events),
  } as unknown as DevicesApiService;
  const software = {
    listRetired: none,
    retiredPage: page([]),
    listTerminatedIsp: none,
    terminatedIspPage: page([]),
    retirementEvents: noEvents,
    ispTerminationEvents: noEvents,
  } as unknown as SoftwareApiService;
  const accounts = { listDisabled: none, disabledPage: page([]), disableEvents: noEvents } as unknown as ServiceAccountsApiService;
  const users = { namesByEmails: () => Promise.resolve(new Map()) } as unknown as UsersApiService;
  const config = {
    getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    getNumber: (name: string) =>
      Promise.resolve({ dashboardMaxItems: 8, dashboardSubnetFullPercent: 80, dashboardSecretStaleDays: 180 }[name]),
  } as unknown as SystemConfigService;
  const disposal = new DisposalApiService(new DisposalService(devices, software, accounts, users, config));
  const emptyPage = { items: [], total: 0, summary: { expired: 0, critical: 0, warning: 0 }, failedKinds: [] };
  return new DashboardService(
    { list: () => Promise.resolve(emptyPage) } as unknown as ExpiryApiService,
    { page: () => Promise.resolve({ items: [], total: 0 }) } as unknown as ApprovalsApiService,
    { describe: () => Promise.resolve(null) } as unknown as ApprovalKindRegistry,
    { listSubnets: () => Promise.resolve([]) } as unknown as IpamApiService,
    { listOwners: () => Promise.resolve([]) } as unknown as VaultApiService,
    disposal,
    config,
    users,
    { recentIncidents: () => Promise.resolve([]) } as unknown as IsoFormsApiService,
  );
}

describe('Trang chủ — khối "Vừa thanh lý" theo ngày vào kho', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('máy thanh lý từ 2024, hôm qua sửa ghi chú → KHÔNG hiện; máy bỏ trong tuần → hiện', async () => {
    const board = await buildService().build({ email: 'sep@pmh.com.vn', role: 'admin' });
    expect(board.disposed.items.map((i) => i.code)).toEqual(['E2E-NEW']);
    expect(board.disposed.total).toBe(1);
  });
});
