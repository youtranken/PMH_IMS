import { ExpiryService } from './expiry.service';
import type { ExpirySourceRegistry } from '../../common/expiry/expiry-registry';
import type { ExpiryItem } from '../../common/expiry/expiry-source';
import type { AuditWriterService } from '../audit/audit-writer.service';
import type { SystemConfigService } from '../config-sys/system-config.service';
import type { Database } from '../../database/database.module';

/*
 * Màn "Sắp hết hạn" sắp ở MÁY CHỦ theo cột người dùng bấm (EX-011) — sắp ở client chỉ đảo chỗ
 * trang đang xem. Và mục phần mềm đã Hết hạn đang chờ TỰ THANH LÝ (Q-13) có ô số + bộ lọc riêng
 * (EX-005): đó là chỗ duy nhất người ta còn kịp cứu trước khi ghế bị gỡ.
 */

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TODAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const ITEMS: ExpiryItem[] = [
  { id: 'a', label: 'Chứng chỉ web', kind: 'ssl', start: null, end: addDays(TODAY, 20), link: '/s/a' },
  {
    id: 'b',
    label: 'AutoCAD',
    kind: 'license',
    start: null,
    end: addDays(TODAY, -10),
    link: '/s/b',
    autoRetireOn: addDays(TODAY, 20),
  },
  { id: 'c', label: 'Bảo hành SW-01', kind: 'warranty', start: null, end: addDays(TODAY, 3), link: '/d/c' },
  { id: 'd', label: 'Tên miền pmh', kind: 'domain', start: null, end: addDays(TODAY, -2), link: '/s/d' },
];

function service(): ExpiryService {
  const registry = {
    collect: () =>
      Promise.resolve({
        // Sổ đăng ký trả theo ngày hết hạn tăng dần — đúng hợp đồng `collect`.
        items: [...ITEMS].sort((x, y) => x.end.localeCompare(y.end)),
        failed: [],
      }),
    list: () => [{ kind: 'license', label: 'License', canRenew: true }],
  } as unknown as ExpirySourceRegistry;
  const config = {
    getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    getNumber: (name: string) => Promise.resolve(name === 'expiryCriticalDays' ? 7 : 30),
  } as unknown as SystemConfigService;
  return new ExpiryService(
    {} as Database,
    registry,
    { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService,
    config,
  );
}

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe('Sắp hết hạn — sắp theo cột ở máy chủ (EX-011)', () => {
  it('mặc định: ngày hết hạn tăng dần (gấp nhất lên đầu)', async () => {
    expect(ids((await service().list({ withinDays: 60 })).items)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('theo ngày giảm dần', async () => {
    expect(ids((await service().list({ withinDays: 60, sort: 'end', dir: 'desc' })).items)).toEqual([
      'a',
      'c',
      'd',
      'b',
    ]);
  });

  it('theo tên hồ sơ (so kiểu tiếng Việt), rồi mới cắt trang', async () => {
    const all = await service().list({ withinDays: 60, sort: 'label' });
    expect(all.items.map((row) => row.label)).toEqual([
      'AutoCAD',
      'Bảo hành SW-01',
      'Chứng chỉ web',
      'Tên miền pmh',
    ]);
    const second = await service().list({ withinDays: 60, sort: 'label', page: 2, limit: 2 });
    expect(ids(second.items)).toEqual(['a', 'd']);
  });

  it('theo loại; cùng loại thì theo ngày hết hạn', async () => {
    expect(ids((await service().list({ withinDays: 60, sort: 'kind', dir: 'asc' })).items)).toEqual([
      'd',
      'b',
      'a',
      'c',
    ]);
  });
});

describe('Sắp hết hạn — mục chờ tự thanh lý (EX-005)', () => {
  it('summary đếm số mục chờ tự thanh lý trên cả kho', async () => {
    const page = await service().list({ withinDays: 60, page: 1, limit: 1 });
    expect(page.summary.autoRetire).toBe(1);
  });

  it('state=autoRetire chỉ còn mục có ngày tự thanh lý; summary vẫn là cả kho', async () => {
    const page = await service().list({ withinDays: 60, state: 'autoRetire' });
    expect(ids(page.items)).toEqual(['b']);
    expect(page.total).toBe(1);
    expect(page.summary.expired).toBe(2);
  });
});
