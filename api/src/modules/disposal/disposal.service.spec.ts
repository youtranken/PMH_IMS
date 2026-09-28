import type { DevicesApiService } from '../devices/devices.api';
import type { ServiceAccountsApiService } from '../service-accounts/service-accounts.api';
import type { SoftwareApiService } from '../software/software.api';
import type { SystemConfigService } from '../config-sys/system-config.service';
import type { UsersApiService } from '../users/users.api';
import { DISPOSAL_KINDS, DisposalService } from './disposal.service';

/**
 * Kho thanh lý gộp bốn nguồn, mỗi nguồn là trạng thái "ngừng dùng" của module chủ.
 *
 * Bài này canh phần gộp: loại nào vào kho, mang nhãn gì, và thứ tự mới-bỏ-lên-đầu. Câu "mỗi
 * nguồn có lọc đúng trạng thái không" thuộc về chính module chủ — xem `api/test/disposal-isp.spec.ts`.
 */
function makeService(
  overrides: {
    devices?: unknown[];
    software?: unknown[];
    accounts?: unknown[];
    isp?: unknown[];
  },
  /** Tổng THẬT của từng nguồn khi nó lớn hơn số dòng trả về — mô phỏng nguồn bị cắt. */
  totals: Partial<Record<'devices' | 'software' | 'accounts' | 'isp', number>> = {},
) {
  const page = (key: 'devices' | 'software' | 'accounts' | 'isp') => () => {
    const items = overrides[key] ?? [];
    return Promise.resolve({ items, total: totals[key] ?? items.length });
  };
  const rows = (key: 'devices' | 'software' | 'accounts' | 'isp') => () =>
    Promise.resolve(overrides[key] ?? []);
  const noEvents = () => Promise.resolve(new Map());
  const devices = {
    listRetired: rows('devices'),
    retiredPage: page('devices'),
    retirementEvents: noEvents,
  } as unknown as DevicesApiService;
  const software = {
    listRetired: rows('software'),
    retiredPage: page('software'),
    listTerminatedIsp: rows('isp'),
    terminatedIspPage: page('isp'),
    retirementEvents: noEvents,
    ispTerminationEvents: noEvents,
  } as unknown as SoftwareApiService;
  const accounts = {
    listDisabled: rows('accounts'),
    disabledPage: page('accounts'),
    disableEvents: noEvents,
  } as unknown as ServiceAccountsApiService;
  const users = { namesByEmails: () => Promise.resolve(new Map()) } as unknown as UsersApiService;
  const config = {
    getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
  } as unknown as SystemConfigService;
  return new DisposalService(devices, software, accounts, users, config);
}

describe('DisposalService', () => {
  it('đường truyền là loại thứ tư của kho (Q-10)', () => {
    expect(DISPOSAL_KINDS).toEqual(['device', 'software', 'service_account', 'isp']);
  });

  it('đường truyền đã thanh lý vào kho: mã, nhà mạng làm tên, băng thông làm chi tiết', async () => {
    const at = new Date('2026-09-20T03:00:00Z');
    const items = await makeService({
      isp: [
        {
          id: 'isp-1',
          code: 'ISP-E2E-01',
          provider: 'VNPT',
          bandwidth: '300 Mbps',
          status: 'terminated',
          updatedAt: at,
        },
      ],
    }).list();

    expect(items).toEqual([
      {
        kind: 'isp',
        id: 'isp-1',
        code: 'ISP-E2E-01',
        name: 'VNPT',
        detail: '300 Mbps',
        status: 'terminated',
        updatedAt: at,
        // Chưa có lịch sử: ngày vào kho lùi về ngày cập nhật, người làm để trống.
        disposedAt: at,
        disposedBy: null,
        disposedByName: null,
        auto: false,
        reason: null,
      },
    ]);
  });

  it('đường truyền không ghi băng thông thì chi tiết là null, không phải chuỗi rỗng', async () => {
    const items = await makeService({
      isp: [{ id: 'i', code: 'C', provider: 'FPT', bandwidth: null, status: 'terminated' }],
    }).list();
    expect(items[0].detail).toBeNull();
    expect(items[0].updatedAt).toBeNull();
  });

  it('bốn loại trộn chung, mới bỏ nhất lên đầu', async () => {
    const items = await makeService({
      devices: [{ id: 'd', code: 'D', name: 'd', status: 'retired', updatedAt: new Date('2026-09-01') }],
      software: [{ id: 's', code: 'S', name: 's', kind: 'license', status: 'retired', updatedAt: new Date('2026-09-03') }],
      accounts: [{ id: 'a', code: 'A', name: 'a', kind: 'shared', status: 'disabled', updatedAt: new Date('2026-09-02') }],
      isp: [{ id: 'i', code: 'I', provider: 'VNPT', bandwidth: null, status: 'terminated', updatedAt: new Date('2026-09-04') }],
    }).list();

    expect(items.map((item) => item.kind)).toEqual(['isp', 'software', 'service_account', 'device']);
  });
});

/**
 * OLD-BE-02 — mỗi nguồn chỉ trả tối đa một trần dòng. Vượt trần mà im lặng thì người đọc tưởng
 * kho chỉ có chừng đó; kho phải nói ra loại nào bị cắt để màn hình báo.
 */
describe('DisposalService.inventory — báo loại bị cắt', () => {
  const one = [{ id: 'd1', code: 'PC-E2E-1', name: 'May', status: 'retired', updatedAt: null }];

  it.each([
    [{}, []],
    [{ devices: 900 }, ['device']],
    [{ devices: 900, isp: 2 }, ['device', 'isp']],
  ])('tổng %j → truncated %j', async (totals, truncated) => {
    const result = await makeService({ devices: one, isp: [] }, totals).inventory({ sort: 'disposedAt', dir: 'desc', page: 1, limit: 50 });
    expect(result.truncated).toEqual(truncated);
    expect(result.items).toHaveLength(1);
  });
});
