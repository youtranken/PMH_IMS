import { runMigrations } from '../src/database/migration-runner';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { createScratchDb, type ScratchDb, migrationsDir } from './db';

/**
 * SW-053 · Q-15 — hộp gán license chọn nhanh "mọi máy của phòng Kế toán" / "mọi máy của chị
 * Bình". Lọc là KHỚP ĐÚNG phòng/người (không phải "có chứa"): "Kế toán" không được kéo theo
 * "Kế toán tổng hợp", vì mỗi máy kéo nhầm là một ghế license bị tiêu nhầm.
 */

const TEST_TIMEOUT = 120_000;
const PAGE = { page: 1, limit: 200 };

describe('SW-053 · lọc thiết bị theo phòng ban / người sử dụng', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;

  async function codes(filter: Parameters<DevicesService['list']>[1]): Promise<string[]> {
    const page = await devices.list(PAGE, filter);
    return page.items.map((d) => d.code).sort();
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_holder_filter');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const noRetirement = {} as DeviceRetirementRegistry;
    devices = new DevicesService(
      scratch.db,
      new CatalogApiService(new CatalogService(scratch.db, audit)),
      audit,
      noRetirement,
      new DeviceSearchRegistry(),
    );
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('PC E2E loc') RETURNING id`,
    );
    const type = rows[0].id;
    const add = (code: string, holder: string | null, department: string | null, status = 'in_use') =>
      scratch.pool.query(
        `INSERT INTO device (code, name, device_type_id, assigned_to, department, status)
         VALUES ($1, 'Máy lọc', $2, $3, $4, $5)`,
        [code, type, holder, department, status],
      );
    await add('E2E-PB-1', 'Chị Bình', 'Kế toán');
    await add('E2E-PB-2', 'Anh Tâm', ' kế toán ');
    await add('E2E-PB-3', 'Chị Bình', 'Kế toán tổng hợp');
    await add('E2E-PB-4', null, 'Kế toán', 'retired');
    await add('E2E-PB-5', 'Chị Bình Minh', 'Kho');
    await add('E2E-PB-6', null, null);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it(
    'phòng ban khớp ĐÚNG tên (không phân biệt hoa thường/dấu/khoảng trắng thừa), không "có chứa"',
    async () => {
      expect(await codes({ department: 'Kế toán' })).toEqual(['E2E-PB-1', 'E2E-PB-2', 'E2E-PB-4']);
      expect(await codes({ department: 'KE TOAN' })).toEqual(['E2E-PB-1', 'E2E-PB-2', 'E2E-PB-4']);
    },
    TEST_TIMEOUT,
  );

  it(
    'ô chọn (usable) bỏ máy đã thanh lý',
    async () => {
      expect(await codes({ department: 'Kế toán', usableOnly: true })).toEqual([
        'E2E-PB-1',
        'E2E-PB-2',
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'Q-20: status=live bỏ máy đã thanh lý (màn Thiết bị mặc định); status=retired vẫn ra',
    async () => {
      expect(await codes({ department: 'Kế toán', status: 'live' })).toEqual([
        'E2E-PB-1',
        'E2E-PB-2',
      ]);
      expect(await codes({ department: 'Kế toán', status: 'retired' })).toEqual(['E2E-PB-4']);
    },
    TEST_TIMEOUT,
  );

  it(
    'người sử dụng khớp đúng người — "Chị Bình" không kéo theo "Chị Bình Minh"',
    async () => {
      expect(await codes({ assignedTo: 'chi binh' })).toEqual(['E2E-PB-1', 'E2E-PB-3']);
    },
    TEST_TIMEOUT,
  );

  it(
    'phòng ban không có máy nào → rỗng; bỏ trống bộ lọc → không lọc',
    async () => {
      expect(await codes({ department: 'Phòng không có' })).toEqual([]);
      expect((await codes({ department: '  ' })).length).toBe(6);
    },
    TEST_TIMEOUT,
  );
});
