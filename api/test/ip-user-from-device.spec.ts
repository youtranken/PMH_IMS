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
 * LF-03 (Q-33): IP gắn máy lấy NGƯỜI DÙNG theo máy, không giữ bản sao riêng. Bản sao trong
 * `ip_address.used_by` là thứ làm sổ IP nói tên người cũ sau khi máy đã đổi tay. IP không gắn
 * máy giữ ô tự ghi như cũ.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.truc@pmh.com.vn';

describe('Người dùng của IP theo máy (LF-03)', () => {
  let scratch: ScratchDb;
  let addresses: IpAddressService;
  let deviceId: string;
  let subnetId: string;
  let subnetIndex = 0;
  /** Người dùng hiện tại của máy, như `devices.api` trả về. */
  let deviceUser: string | null = 'Chị Mới';

  beforeAll(async () => {
    scratch = await createScratchDb('ims_ip_user_from_device');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = drizzle(scratch.pool) as unknown as Database;
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const devices = {
      assertUsableWithin: () => Promise.resolve(),
      getByIds: (ids: string[]) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              {
                id,
                code: 'PC-LF03',
                name: 'May ke toan',
                siteCode: null,
                assignedTo: deviceUser,
                department: 'Kế toán',
              },
            ]),
          ),
        ),
    } as unknown as DevicesApiService;
    const subnets = {
      cidrOf: () => Promise.resolve(`172.19.${subnetIndex}.0/24`),
    } as unknown as SubnetService;
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    } as unknown as SystemConfigService;
    addresses = new IpAddressService(db, audit, devices, subnets, config);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    subnetIndex += 1;
    deviceUser = 'Chị Mới';
    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ($1) RETURNING id`,
      [`PC lf03 ${subnetIndex}`],
    );
    const device = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id, status)
       VALUES ($1, 'May ke toan', $2, 'in_use') RETURNING id`,
      [`PC-LF03-${subnetIndex}`, type.rows[0].id],
    );
    deviceId = device.rows[0].id;
    const subnet = await scratch.pool.query<{ id: string }>(
      `INSERT INTO subnet (name, cidr, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [`Dai lf03 ${subnetIndex}`, `172.19.${subnetIndex}.0/24`, ACTOR],
    );
    subnetId = subnet.rows[0].id;
  });

  const address = (host = 5) => `172.19.${subnetIndex}.${host}`;

  async function storedUsedBy(id: string): Promise<string | null> {
    const { rows } = await scratch.pool.query<{ used_by: string | null }>(
      `SELECT used_by FROM ip_address WHERE id = $1`,
      [id],
    );
    return rows[0].used_by;
  }

  it('hồ sơ cũ còn bản sao tên người cũ: đọc ra người dùng HIỆN TẠI của máy', async () => {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO ip_address (subnet_id, address, status, device_id, used_by, assigned_by)
       VALUES ($1, $2, 'assigned', $3, 'Anh Cũ', $4) RETURNING id`,
      [subnetId, address(), deviceId, ACTOR],
    );
    expect((await addresses.findOne(rows[0].id)).usedBy).toBe('Chị Mới — Kế toán');
    deviceUser = null;
    // Máy chưa khai người dùng thì còn phòng ban của máy — không lôi tên người cũ ra.
    expect((await addresses.findOne(rows[0].id)).usedBy).toBe('Kế toán');
  });

  it('cấp IP cho máy: không ghi bản sao người dùng vào hồ sơ IP', async () => {
    const created = await addresses.create(ACTOR, {
      subnetId,
      address: address(),
      deviceId,
      usedBy: 'Anh Cũ',
    });
    expect(await storedUsedBy(created.id)).toBeNull();
    expect(created.usedBy).toBe('Chị Mới — Kế toán');
  });

  it('cấp một ô Trống cho máy qua đổi trạng thái: cũng không giữ bản sao', async () => {
    const free = await addresses.create(ACTOR, { subnetId, address: address(), usedBy: 'Kho' });
    await addresses.transition(ACTOR, free.id, 'free', { reason: 'tra lai' });
    const assigned = await addresses.transition(ACTOR, free.id, 'assigned', {
      deviceId,
      usedBy: 'Anh Cũ',
    });
    expect(await storedUsedBy(free.id)).toBeNull();
    expect(assigned.usedBy).toBe('Chị Mới — Kế toán');
  });

  it('sửa hồ sơ gắn máy vào: bỏ bản sao; IP KHÔNG gắn máy giữ ô tự ghi', async () => {
    const own = await addresses.create(ACTOR, {
      subnetId,
      address: address(6),
      usedBy: 'Máy chấm công',
    });
    expect(await storedUsedBy(own.id)).toBe('Máy chấm công');
    expect(own.usedBy).toBe('Máy chấm công');

    const moved = await addresses.update(ACTOR, own.id, { deviceId, usedBy: 'Máy chấm công' });
    expect(await storedUsedBy(own.id)).toBeNull();
    expect(moved.usedBy).toBe('Chị Mới — Kế toán');
  });
});
