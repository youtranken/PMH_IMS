import type { DevicesApiService } from '../devices/devices.api';
import type { ServiceAccountsApiService } from '../service-accounts/service-accounts.api';
import type { SoftwareApiService } from '../software/software.api';
import { DISPOSAL_KINDS, DisposalService } from './disposal.service';

/**
 * Kho thanh lý gộp bốn nguồn, mỗi nguồn là trạng thái "ngừng dùng" của module chủ.
 *
 * Bài này canh phần gộp: loại nào vào kho, mang nhãn gì, và thứ tự mới-bỏ-lên-đầu. Câu "mỗi
 * nguồn có lọc đúng trạng thái không" thuộc về chính module chủ — xem `api/test/disposal-isp.spec.ts`.
 */
function makeService(overrides: {
  devices?: unknown[];
  software?: unknown[];
  accounts?: unknown[];
  isp?: unknown[];
}) {
  const devices = {
    listRetired: () => Promise.resolve(overrides.devices ?? []),
  } as unknown as DevicesApiService;
  const software = {
    listRetired: () => Promise.resolve(overrides.software ?? []),
    listTerminatedIsp: () => Promise.resolve(overrides.isp ?? []),
  } as unknown as SoftwareApiService;
  const accounts = {
    listDisabled: () => Promise.resolve(overrides.accounts ?? []),
  } as unknown as ServiceAccountsApiService;
  return new DisposalService(devices, software, accounts);
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
