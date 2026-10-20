import { DashboardService } from './dashboard.service';
import type { ApprovalKindRegistry } from '../../common/approvals/approvals-registry';
import type { ApprovalsApiService } from '../approvals/approvals.api';
import type { SystemConfigService } from '../config-sys/system-config.service';
import type { DisposalApiService } from '../disposal/disposal.api';
import type { ExpiryApiService } from '../expiry/expiry.api';
import type { IpamApiService } from '../ipam/ipam.api';
import type { IsoFormsApiService } from '../iso-forms/iso-forms.api';
import type { UsersApiService } from '../users/users.api';
import type { VaultApiService } from '../vault/vault.api';

/**
 * Q-31: khối của mảng bị nhóm quyền ẩn bị cắt ở SERVICE, không chỉ ẩn ở web — cùng lý do với
 * khối break-glass: ẩn ở web thì dữ liệu vẫn đi qua dây.
 */
describe('Bảng điều khiển theo nhóm quyền (Q-31)', () => {
  const emptyPage = { items: [], total: 0, summary: { expired: 0, critical: 0, warning: 0 }, failedKinds: [] };
  const calls = { expiry: jest.fn(), subnets: jest.fn(), disposed: jest.fn(), incidents: jest.fn() };

  function service(): DashboardService {
    calls.expiry.mockResolvedValue(emptyPage);
    calls.subnets.mockResolvedValue([]);
    calls.disposed.mockResolvedValue([]);
    calls.incidents.mockResolvedValue([]);
    return new DashboardService(
      { list: calls.expiry } as unknown as ExpiryApiService,
      { page: () => Promise.resolve({ items: [], total: 0 }) } as unknown as ApprovalsApiService,
      { describe: () => Promise.resolve(null) } as unknown as ApprovalKindRegistry,
      { listSubnets: calls.subnets } as unknown as IpamApiService,
      { listOwners: () => Promise.resolve([]) } as unknown as VaultApiService,
      { changedSince: calls.disposed } as unknown as DisposalApiService,
      {
        getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
        getNumber: () => Promise.resolve(8),
      } as unknown as SystemConfigService,
      { namesByEmails: () => Promise.resolve(new Map()) } as unknown as UsersApiService,
      { recentIncidents: calls.incidents } as unknown as IsoFormsApiService,
    );
  }

  beforeEach(() => Object.values(calls).forEach((fn) => fn.mockReset()));

  it('nhóm chỉ có Tổng quan + Mạng: không hỏi hạn, thanh lý, sự cố', async () => {
    const board = await service().build({ email: 'm@pmh.com.vn', role: 'member', features: ['overview', 'network'] });
    expect(board.expiring.available).toBe(false);
    expect(board.disposed.available).toBe(false);
    expect(board.incidents.available).toBe(false);
    expect(board.subnetLoad.available).toBe(true);
    expect(calls.expiry).not.toHaveBeenCalled();
    expect(calls.disposed).not.toHaveBeenCalled();
    expect(calls.incidents).not.toHaveBeenCalled();
  });

  it('nhóm Tổng quan + Tài sản + 0206: có hạn, thanh lý, sự cố; không dải mạng', async () => {
    const board = await service().build({
      email: 'm@pmh.com.vn',
      role: 'member',
      features: ['overview', 'assets', 'iso_0206', 'expiry', 'iso'],
    });
    expect(board.expiring.available).toBe(true);
    expect(board.incidents.available).toBe(true);
    expect(board.subnetLoad.available).toBe(false);
    expect(calls.subnets).not.toHaveBeenCalled();
  });

  it('không bị giới hạn (features = null): hỏi đủ mọi khối như trước Q-31', async () => {
    const board = await service().build({ email: 'm@pmh.com.vn', role: 'member', features: null });
    expect(board.expiring.available).toBe(true);
    expect(board.subnetLoad.available).toBe(true);
    expect(board.incidents.available).toBe(true);
  });
});
