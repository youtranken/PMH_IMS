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
 * Q-14 (làm rõ Q-02): có hồ sơ IP là Đang dùng, nên hồ sơ phải gắn THIẾT BỊ hoặc NGƯỜI/BỘ
 * PHẬN. Hồ sơ không chủ là dòng "Trống" mồ côi đứng cạnh ô trống thật — người dùng không biết
 * mình vừa tạo gì, và chip đếm "Trống" không đổi.
 *
 * Hàng rào nằm ở service (mọi cửa ghi đi qua đây), nên kiểm trên DB thật: bài phải chứng minh
 * không có hàng nào được ghi, không chỉ là có mã lỗi.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.truc@pmh.com.vn';

describe('Hồ sơ IP phải có chủ (Q-14)', () => {
  let scratch: ScratchDb;
  let addresses: IpAddressService;
  let deviceId: string;
  let subnetId: string;
  let subnetIndex = 0;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_ip_owner_required');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = drizzle(scratch.pool) as unknown as Database;
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const devices = {
      assertUsableWithin: () => Promise.resolve(),
      getByIds: () => Promise.resolve(new Map()),
    } as unknown as DevicesApiService;
    const subnets = {
      cidrOf: () => Promise.resolve(`172.18.${subnetIndex}.0/24`),
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
    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ($1) RETURNING id`,
      [`PC chu ${subnetIndex}`],
    );
    const device = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id, status)
       VALUES ($1, 'May ke toan', $2, 'in_use') RETURNING id`,
      [`PC-CHU-${subnetIndex}`, type.rows[0].id],
    );
    deviceId = device.rows[0].id;
    const subnet = await scratch.pool.query<{ id: string }>(
      `INSERT INTO subnet (name, cidr, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [`Dai chu ${subnetIndex}`, `172.18.${subnetIndex}.0/24`, ACTOR],
    );
    subnetId = subnet.rows[0].id;
  });

  function address(host = 5): string {
    return `172.18.${subnetIndex}.${host}`;
  }

  async function countRows(): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM ip_address WHERE subnet_id = $1`,
      [subnetId],
    );
    return Number(rows[0].n);
  }

  async function seed(
    status: 'free' | 'assigned',
    owner: { deviceId?: string; usedBy?: string } = {},
  ): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO ip_address (subnet_id, address, status, device_id, used_by, assigned_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [subnetId, address(), status, owner.deviceId ?? null, owner.usedBy ?? null, ACTOR],
    );
    return rows[0].id;
  }

  async function rowOf(id: string) {
    const { rows } = await scratch.pool.query<{
      status: string;
      device_id: string | null;
      used_by: string | null;
      assigned_at: string | null;
      note: string | null;
    }>(
      `SELECT status, device_id, used_by, assigned_at::text, note FROM ip_address WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  describe('Tạo hồ sơ (POST)', () => {
    it.each([
      ['không có gì', {}],
      ['ô người dùng chỉ có dấu cách', { usedBy: '   ' }],
      ['deviceId rỗng', { deviceId: '', usedBy: '' }],
    ])(
      'từ chối khi %s — và KHÔNG ghi hàng nào',
      async (_label, owner) => {
        await expect(
          addresses.create(ACTOR, { subnetId, address: address(), note: 'de danh', ...owner }),
        ).rejects.toMatchObject({ response: { code: 'IP_OWNER_REQUIRED' } });
        expect(await countRows()).toBe(0);
      },
      TEST_TIMEOUT,
    );

    it(
      'nhận khi có người/bộ phận → Đang dùng',
      async () => {
        const created = await addresses.create(ACTOR, {
          subnetId,
          address: address(),
          usedBy: 'Phòng Kế toán',
        });
        expect(created.status).toBe('assigned');
      },
      TEST_TIMEOUT,
    );

    it(
      'nhận khi chỉ có thiết bị → Đang dùng',
      async () => {
        const created = await addresses.create(ACTOR, { subnetId, address: address(), deviceId });
        expect(created.status).toBe('assigned');
      },
      TEST_TIMEOUT,
    );
  });

  describe('Cấp lại hồ sơ đang Trống (transition → assigned)', () => {
    it(
      'từ chối khi không có chủ mới — hồ sơ giữ nguyên Trống',
      async () => {
        const id = await seed('free');
        await expect(
          addresses.transition(ACTOR, id, 'assigned', { usedBy: '', reason: 'cap lai' }),
        ).rejects.toMatchObject({ response: { code: 'IP_OWNER_REQUIRED' } });
        await expect(addresses.transition(ACTOR, id, 'assigned')).rejects.toMatchObject({
          response: { code: 'IP_OWNER_REQUIRED' },
        });
        expect((await rowOf(id)).status).toBe('free');
      },
      TEST_TIMEOUT,
    );

    it(
      'nhận thiết bị, ngày cấp và ghi chú trong MỘT lượt (hộp "Cấp IP" dùng chung)',
      async () => {
        const id = await seed('free');
        await addresses.transition(ACTOR, id, 'assigned', {
          deviceId,
          usedBy: 'Chị Lan',
          assignedAt: '2026-03-04',
          note: '  camera cổng  ',
        });
        expect(await rowOf(id)).toMatchObject({
          status: 'assigned',
          device_id: deviceId,
          used_by: 'Chị Lan',
          assigned_at: '2026-03-04',
          note: 'camera cổng',
        });
      },
      TEST_TIMEOUT,
    );
  });

  describe('Sửa hồ sơ (PATCH)', () => {
    it(
      'xoá cả máy lẫn người dùng của hồ sơ Đang dùng bị từ chối',
      async () => {
        const id = await seed('assigned', { usedBy: 'Chị Lan' });
        await expect(addresses.update(ACTOR, id, { usedBy: '' })).rejects.toMatchObject({
          response: { code: 'IP_OWNER_REQUIRED' },
        });
        expect((await rowOf(id)).used_by).toBe('Chị Lan');
      },
      TEST_TIMEOUT,
    );

    it(
      'đổi từ máy sang người dùng thì được — vẫn còn một chủ',
      async () => {
        const id = await seed('assigned', { deviceId });
        await addresses.update(ACTOR, id, { deviceId: '', usedBy: 'Kho' });
        expect(await rowOf(id)).toMatchObject({ device_id: null, used_by: 'Kho' });
      },
      TEST_TIMEOUT,
    );

    it(
      'sửa ghi chú của hồ sơ Trống mồ côi có sẵn thì không bị chặn',
      async () => {
        const id = await seed('free');
        await addresses.update(ACTOR, id, { note: 'giữ cho máy in mới' });
        expect(await rowOf(id)).toMatchObject({ status: 'free', note: 'giữ cho máy in mới' });
      },
      TEST_TIMEOUT,
    );
  });
});
