import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { IpAddressService } from '../src/modules/ipam/ip-address.service';
import { IpamApiService } from '../src/modules/ipam/ipam.api';
import { IpDeviceSearch } from '../src/modules/ipam/ip-device-search';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import type { SubnetService } from '../src/modules/ipam/subnet.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Q-14 — ô tìm ở danh sách thiết bị trả lời được "10.77.1.50 là máy nào?" và "máy của chị Bình
 * đâu?". Đi qua ĐÚNG đường sản phẩm: `DevicesService.list` → sổ `DeviceSearchRegistry` →
 * `ipam` (qua `ipam.api`) → bảng `ip_address` thật. Không dựng `Pool` giả.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'device-search@test';
const PAGE = { page: 1, limit: 50 };

describe('Q-14 · tìm thiết bị theo IP, người sử dụng, bộ phận', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;
  const id: Record<string, string> = {};

  async function one(text: string, params: unknown[] = []): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(text, params);
    return rows[0].id;
  }

  async function codes(search: string): Promise<{ codes: string[]; total: number }> {
    const page = await devices.list(PAGE, { search });
    return { codes: page.items.map((d) => d.code).sort(), total: page.total };
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_search');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });

    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const noRetirement = {
      holdingsWithin: () => Promise.resolve([]),
      releaseAllWithin: () => Promise.resolve(),
    } as unknown as DeviceRetirementRegistry;
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    } as unknown as SystemConfigService;
    const noDevices = { getByIds: () => Promise.resolve(new Map()) } as unknown as DevicesApiService;
    const noSubnets = {} as SubnetService;

    const addresses = new IpAddressService(scratch.db, audit, noDevices, noSubnets, config);
    const ipam = new IpamApiService(addresses, noSubnets);
    const registry = new DeviceSearchRegistry();
    const contributor = new IpDeviceSearch(registry, ipam);
    contributor.onModuleInit();

    const catalog = new CatalogApiService(new CatalogService(scratch.db, audit));
    devices = new DevicesService(scratch.db, catalog, audit, noRetirement, registry);

    const type = await one(`INSERT INTO device_type (name) VALUES ('PC E2E') RETURNING id`);
    const insert = (code: string, extra = '') =>
      one(
        `INSERT INTO device (code, name, device_type_id${extra ? ', assigned_to, department' : ''})
         VALUES ($1, 'Máy kiểm tìm', $2${extra ? ', $3, $4' : ''}) RETURNING id`,
        extra ? [code, type, ...extra.split('|')] : [code, type],
      );
    id.a = await insert('E2E-SRCH-A', 'Chị Bình|Phòng Kế hoạch');
    id.b = await insert('E2E-SRCH-B');
    id.c = await insert('E2E-SRCH-C');
    id.d = await insert('E2E-SRCH-D');

    const subnet = await one(
      `INSERT INTO subnet (name, cidr, created_by) VALUES ('Dai tim', '10.77.1.0/24', $1)
       RETURNING id`,
      [ACTOR],
    );
    const ip = (address: string, deviceId: string | null, status: string, voided = false) =>
      scratch.pool.query(
        `INSERT INTO ip_address (subnet_id, address, status, device_id, assigned_by, assigned_at,
                                 voided_at, voided_by, void_reason)
         VALUES ($1, $2, $3, $4, $5, '2026-01-02', $6, $7, $8)`,
        [
          subnet,
          address,
          status,
          deviceId,
          ACTOR,
          voided ? new Date() : null,
          voided ? ACTOR : null,
          voided ? 'kiem' : null,
        ],
      );
    await ip('10.77.1.50', id.a, 'assigned');
    await ip('10.77.1.5', id.b, 'assigned');
    // Hồ sơ đã ẩn và hồ sơ đã thu hồi không còn "đang giữ" — không được chỉ về máy cũ.
    await ip('10.77.1.51', id.c, 'assigned', true);
    await ip('10.77.1.52', null, 'free');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it(
    'gõ đủ IP ra ĐÚNG máy đang giữ nó — không kéo theo .50 khi gõ .5',
    async () => {
      expect(await codes('10.77.1.50')).toEqual({ codes: ['E2E-SRCH-A'], total: 1 });
      expect(await codes('10.77.1.5')).toEqual({ codes: ['E2E-SRCH-B'], total: 1 });
    },
    TEST_TIMEOUT,
  );

  it(
    'gõ thiếu nhóm cuối ra mọi máy trong nhóm đó',
    async () => {
      expect(await codes('10.77.1')).toEqual({ codes: ['E2E-SRCH-A', 'E2E-SRCH-B'], total: 2 });
    },
    TEST_TIMEOUT,
  );

  it(
    'IP đã ẩn hồ sơ hoặc chưa cấp cho máy nào thì không chỉ về máy nào',
    async () => {
      expect(await codes('10.77.1.51')).toEqual({ codes: [], total: 0 });
      expect(await codes('10.77.1.52')).toEqual({ codes: [], total: 0 });
    },
    TEST_TIMEOUT,
  );

  it(
    'tìm theo người sử dụng và bộ phận, không dấu',
    async () => {
      expect(await codes('chi binh')).toEqual({ codes: ['E2E-SRCH-A'], total: 1 });
      expect(await codes('ke hoach')).toEqual({ codes: ['E2E-SRCH-A'], total: 1 });
    },
    TEST_TIMEOUT,
  );

  it(
    'từ khoá thường vẫn đi đường cũ; lọc khác vẫn chồng lên kết quả IP',
    async () => {
      expect((await codes('SRCH-D')).codes).toEqual(['E2E-SRCH-D']);
      const page = await devices.list(PAGE, { search: '10.77.1', status: 'broken' });
      expect(page.total).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    'xuất Excel dùng cùng bộ lọc với màn hình',
    async () => {
      const all = await devices.listAll({ search: '10.77.1.50' });
      expect(all.map((d) => d.code)).toEqual(['E2E-SRCH-A']);
    },
    TEST_TIMEOUT,
  );
});
