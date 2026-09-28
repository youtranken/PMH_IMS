import { queryInventory, type DisposalQuery } from './disposal-query';
import type { DisposalItem } from './disposal.types';

const TZ = 'Asia/Ho_Chi_Minh';

function item(
  code: string,
  kind: DisposalItem['kind'],
  disposedAt: string | null,
  extra: Partial<DisposalItem> = {},
): DisposalItem {
  return {
    kind,
    id: code,
    code,
    name: `Tên ${code}`,
    detail: null,
    status: 'retired',
    updatedAt: disposedAt ? new Date(disposedAt) : null,
    disposedAt: disposedAt ? new Date(disposedAt) : null,
    disposedBy: null,
    disposedByName: null,
    auto: false,
    reason: null,
    ...extra,
  };
}

const ITEMS: DisposalItem[] = [
  item('DEV-A', 'device', '2026-06-30T17:30:00Z'), // 01/07 00:30 giờ VN
  item('SW-B', 'software', '2026-09-04T03:00:00Z', { name: 'Máy trạm Kế toán' }),
  item('SA-C', 'service_account', '2026-08-01T03:00:00Z'),
  item('ISP-D', 'isp', null),
  item('DEV-E', 'device', '2026-09-20T03:00:00Z'),
];

const BASE: DisposalQuery = { sort: 'disposedAt', dir: 'desc', page: 1, limit: 50 };
const codes = (q: Partial<DisposalQuery>) =>
  queryInventory(ITEMS, { ...BASE, ...q }, TZ).items.map((row) => row.code);

describe('queryInventory — lọc/sắp/phân trang kho thanh lý', () => {
  it.each<[string, Partial<DisposalQuery>, string[]]>([
    ['mặc định: mới vào kho nhất lên đầu, chưa rõ ngày xuống cuối', {}, ['DEV-E', 'SW-B', 'SA-C', 'DEV-A', 'ISP-D']],
    ['cũ nhất lên đầu, chưa rõ ngày vẫn ở cuối', { dir: 'asc' }, ['DEV-A', 'SA-C', 'SW-B', 'DEV-E', 'ISP-D']],
    ['sắp theo mã', { sort: 'code', dir: 'asc' }, ['DEV-A', 'DEV-E', 'ISP-D', 'SA-C', 'SW-B']],
    ['theo loại', { kind: 'device' }, ['DEV-E', 'DEV-A']],
    ['tìm bỏ dấu theo tên', { search: 'may tram' }, ['SW-B']],
    ['tìm theo mã', { search: 'isp-d' }, ['ISP-D']],
    // 30/06 17:30 UTC là 01/07 giờ VN: "từ 01/07" phải lấy nó, "đến 30/06" thì không.
    ['từ ngày theo giờ VN', { from: '2026-07-01' }, ['DEV-E', 'SW-B', 'SA-C', 'DEV-A']],
    ['đến ngày theo giờ VN', { to: '2026-06-30' }, []],
    ['khoảng quý 3', { from: '2026-07-01', to: '2026-09-30' }, ['DEV-E', 'SW-B', 'SA-C', 'DEV-A']],
    ['khoảng một ngày', { from: '2026-09-04', to: '2026-09-04' }, ['SW-B']],
  ])('%s', (_name, q, expected) => {
    expect(codes(q)).toEqual(expected);
  });

  it('phân trang trên tập đã lọc, total là tổng sau lọc', () => {
    const page2 = queryInventory(ITEMS, { ...BASE, page: 2, limit: 2 }, TZ);
    expect(page2.total).toBe(5);
    expect(page2.items.map((row) => row.code)).toEqual(['SA-C', 'DEV-A']);
  });

  it('đếm theo loại tính trên tập đã lọc ngày/từ khoá nhưng KHÔNG theo chính ô loại', () => {
    const result = queryInventory(ITEMS, { ...BASE, kind: 'device', from: '2026-09-01' }, TZ);
    expect(result.total).toBe(1);
    expect(result.counts).toEqual({ device: 1, software: 1, service_account: 0, isp: 0 });
  });
});
