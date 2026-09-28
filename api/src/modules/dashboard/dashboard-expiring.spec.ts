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

type ListOptions = { includeExpired?: boolean; state?: string; limit?: number };

/** Nguồn giả trả lời ĐÚNG câu được hỏi: sắp tới (không nhìn lùi) hoặc chỉ nhóm quá hạn. */
function buildService(
  failedKinds: string[],
  data: { upcoming: ReturnType<typeof row>[]; overdue: ReturnType<typeof row>[] } = {
    upcoming: [row('ssl-1', 2)],
    overdue: [],
  },
): DashboardService {
  const expiry = {
    list: (options: ListOptions = {}) => {
      const all =
        options.state === 'expired'
          ? data.overdue
          : options.includeExpired === false
            ? data.upcoming
            : [...data.overdue, ...data.upcoming];
      return Promise.resolve({
        items: all.slice(0, options.limit ?? all.length),
        total: all.length,
        summary: { expired: 0, critical: 0, warning: 0 },
        failedKinds,
      });
    },
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

/**
 * BE-05 — hai mươi hồ sơ quá hạn lâu năm không được đẩy chứng chỉ còn 2 ngày ra khỏi khối.
 */
describe('Khối "sắp hết hạn" khi có nhiều mục quá hạn', () => {
  const overdue = Array.from({ length: 20 }, (_, i) => row(`qua-${i}`, -300 + i));

  it('mục còn 2 ngày vẫn lên, và total đếm đủ cả hai nhóm', async () => {
    const board = await buildService([], { upcoming: [row('ssl-2-ngay', 2)], overdue }).build({
      email: 'sep@pmh.com.vn',
      role: 'admin',
    });
    expect(board.expiring.items.map((item) => item.label)).toContain('ssl-2-ngay');
    expect(board.expiring.items.length).toBeLessThanOrEqual(8);
    expect(board.expiring.total).toBe(21);
  });
});

/**
 * DASH-002 — khối "Sắp hết hạn" có nút Gia hạn ngay tại dòng, nên mỗi dòng phải mang đủ thứ
 * mà `POST /expiry/renew` cần (`kind` + `id`) và cờ `canRenew` do chính module expiry quyết —
 * trang chủ không tự đoán loại nào gia hạn được.
 */
describe('Khối "sắp hết hạn" mang đủ dữ liệu để gia hạn tại chỗ', () => {
  it('mỗi dòng có id và canRenew lấy từ nguồn', async () => {
    const renewable = { ...row('ssl-1', 2), canRenew: true };
    const warranty = { ...row('bh-1', 5), kind: 'warranty', canRenew: false };
    const board = await buildService([], { upcoming: [renewable, warranty], overdue: [] }).build({
      email: 'sep@pmh.com.vn',
      role: 'admin',
    });
    expect(board.expiring.items).toEqual([
      expect.objectContaining({ id: 'ssl-1', kind: 'ssl', canRenew: true }),
      expect.objectContaining({ id: 'bh-1', kind: 'warranty', canRenew: false }),
    ]);
  });
});
