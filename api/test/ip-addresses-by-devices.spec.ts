import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../src/database/migration-runner';
import type { Database } from '../src/database/database.module';
import { IpAddressService } from '../src/modules/ipam/ip-address.service';
import type { SubnetService } from '../src/modules/ipam/subnet.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * `GET ipam/devices/addresses?deviceIds=` — cột IP của danh sách thiết bị hỏi MỘT lượt cho cả
 * trang. Chỉ địa chỉ máy đang GIỮ: hồ sơ đã ẩn hay đã trả về pool mà vẫn hiện cạnh máy cũ là
 * trả lời sai câu "máy này IP gì".
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.truc@pmh.com.vn';

describe('IP đang giữ của nhiều máy một lượt', () => {
  let scratch: ScratchDb;
  let addresses: IpAddressService;
  const device: Record<string, string> = {};

  beforeAll(async () => {
    scratch = await createScratchDb('ims_ip_by_devices');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = drizzle(scratch.pool) as unknown as Database;

    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('May cot IP') RETURNING id`,
    );
    for (const code of ['SW-COT-01', 'PC-COT-02', 'PC-COT-03']) {
      const { rows } = await scratch.pool.query<{ id: string }>(
        `INSERT INTO device (code, name, device_type_id, status)
         VALUES ($1, $2, $3, 'in_use') RETURNING id`,
        [code, `Máy ${code}`, type.rows[0].id],
      );
      device[code] = rows[0].id;
    }

    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    addresses = new IpAddressService(
      db,
      audit,
      {} as unknown as DevicesApiService,
      {} as unknown as SubnetService,
      {} as unknown as SystemConfigService,
    );

    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO subnet (name, cidr, vlan, created_by) VALUES ('LAN cot', '10.66.1.0/24', 10, $1)
       RETURNING id`,
      [ACTOR],
    );
    const subnet = rows[0].id;
    const ip = async (
      address: string,
      code: string,
      status: string,
      voided = false,
    ): Promise<void> => {
      await scratch.pool.query(
        `INSERT INTO ip_address (subnet_id, address, status, device_id, assigned_by,
                                 voided_at, voided_by, void_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          subnet,
          address,
          status,
          device[code],
          ACTOR,
          voided ? new Date() : null,
          voided ? ACTOR : null,
          voided ? 'nhap nham' : null,
        ],
      );
    };
    await ip('10.66.1.20', 'SW-COT-01', 'assigned');
    await ip('10.66.1.3', 'PC-COT-03', 'assigned');
    await ip('10.66.1.40', 'PC-COT-02', 'assigned', true);
    await ip('10.66.1.41', 'PC-COT-02', 'free');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  // Một máy giữ tối đa một IP đang cấp (Q-20, chỉ mục `ip_address_device_uq`).
  it('mỗi máy → đúng địa chỉ nó đang giữ', async () => {
    const map = await addresses.heldAddressesOf([device['SW-COT-01'], device['PC-COT-03']]);
    expect(map.get(device['SW-COT-01'])).toEqual(['10.66.1.20']);
    expect(map.get(device['PC-COT-03'])).toEqual(['10.66.1.3']);
  });

  it('bỏ hồ sơ đã ẩn và hồ sơ đã trả về pool; máy không giữ gì thì không có khóa', async () => {
    const map = await addresses.heldAddressesOf([device['PC-COT-02']]);
    expect(map.size).toBe(0);
  });

  it('danh sách rỗng không chạm DB', async () => {
    expect((await addresses.heldAddressesOf([])).size).toBe(0);
  });
});
