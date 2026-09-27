import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../src/database/migration-runner';
import type { Database } from '../src/database/database.module';
import { IpAddressService } from '../src/modules/ipam/ip-address.service';
import { IpDeviceRetirement } from '../src/modules/ipam/ip-device-retirement';
import type { NatRuleService } from '../src/modules/ipam/nat-rule.service';
import type { SubnetService } from '../src/modules/ipam/subnet.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * IP CHỈ CÒN HAI TRẠNG THÁI: 'free' (Trống) và 'assigned' (Đang dùng) — QUYET-DINH Q-02.
 *
 * Hai nửa, vì hai nửa hỏng theo hai kiểu khác nhau:
 *
 *   1. Migration 0063 đổi dữ liệu ĐÃ CÓ. Sai ở đây là mất chủ của một IP đang dùng, hoặc để
 *      lại một hàng "trống mà có chủ" — hàng lai đó khoá thiết bị khi thanh lý (A-06). Chỉ
 *      kiểm được bằng cách dựng DB ở trạng thái TRƯỚC 0063, gieo dữ liệu cũ, rồi chạy tiếp.
 *
 *   2. Đường "Thu hồi" giờ đi `assigned → free` và phải làm đúng những gì nó từng làm khi đích
 *      còn là `reclaimed`: xoá máy và người dùng, giữ phần còn lại, ghi chủ cũ vào lịch sử.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.truc@pmh.com.vn';
const TWO_STATES_MIGRATION = '0063_ip_two_states.sql';

describe('Migration 0063 — gộp bốn trạng thái IP về hai', () => {
  let scratch: ScratchDb;
  let subnetId: string;
  let deviceId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    scratch = await createScratchDb('ims_ip_two_states_mig');

    const before = await mkdtemp(join(tmpdir(), 'ims-mig-before-0063-'));
    const files = (await readdir(migrationsDir())).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files.filter((name) => name < TWO_STATES_MIGRATION)) {
      await writeFile(join(before, f), await readFile(join(migrationsDir(), f)));
    }
    await runMigrations(scratch.pool, before, { log: () => undefined });

    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('PC mig') RETURNING id`,
    );
    const device = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id, status)
       VALUES ('PC-MIG-1', 'May ke toan', $1, 'in_use') RETURNING id`,
      [type.rows[0].id],
    );
    deviceId = device.rows[0].id;
    const subnet = await scratch.pool.query<{ id: string }>(
      `INSERT INTO subnet (name, cidr, created_by) VALUES ('Dai mig', '172.30.0.0/24', $1)
       RETURNING id`,
      [ACTOR],
    );
    subnetId = subnet.rows[0].id;

    const seed = async (
      key: string,
      host: number,
      status: string,
      owner: { device?: boolean; usedBy?: string; voided?: boolean } = {},
    ): Promise<void> => {
      const { rows } = await scratch.pool.query<{ id: string }>(
        `INSERT INTO ip_address
           (subnet_id, address, status, device_id, used_by, assigned_by, assigned_at, note,
            voided_at, voided_by, void_reason)
         VALUES ($1, $2, $3, $4, $5, $6, '2026-01-02', 'ghi chu giu nguyen',
                 $7, $8, $9)
         RETURNING id`,
        [
          subnetId,
          `172.30.0.${host}`,
          status,
          owner.device ? deviceId : null,
          owner.usedBy ?? null,
          ACTOR,
          owner.voided ? new Date() : null,
          owner.voided ? ACTOR : null,
          owner.voided ? 'nhap nham' : null,
        ],
      );
      ids[key] = rows[0].id;
    };

    await seed('suspect', 10, 'suspect_dead', { device: true, usedBy: 'Phong Ke toan' });
    await seed('reclaimed', 11, 'reclaimed');
    await seed('reclaimedHybrid', 12, 'reclaimed', { device: true, usedBy: 'Chu cu' });
    await seed('reclaimedVoided', 13, 'reclaimed', { voided: true });
    await seed('assigned', 14, 'assigned', { device: true, usedBy: 'Chi Lan' });
    await seed('free', 15, 'free');

    // Dòng lịch sử CŨ mang tên trạng thái cũ — chỉ-thêm, migration không được đụng.
    await scratch.pool.query(
      `INSERT INTO ip_history (ip_address_id, action, actor, from_status, to_status)
       VALUES ($1, 'Thu hồi', $2, 'assigned', 'reclaimed')`,
      [ids.reclaimed, ACTOR],
    );

    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function row(key: string) {
    const { rows } = await scratch.pool.query<{
      status: string;
      device_id: string | null;
      used_by: string | null;
      note: string | null;
      assigned_at: string | null;
    }>(
      `SELECT status, device_id, used_by, note, assigned_at::text FROM ip_address WHERE id = $1`,
      [ids[key]],
    );
    return rows[0];
  }

  it('"nghi chết" → đang dùng, GIỮ nguyên máy và người dùng', async () => {
    expect(await row('suspect')).toMatchObject({
      status: 'assigned',
      device_id: deviceId,
      used_by: 'Phong Ke toan',
    });
  });

  it('"đã thu hồi" → trống, giữ ghi chú và ngày cấp', async () => {
    expect(await row('reclaimed')).toMatchObject({
      status: 'free',
      device_id: null,
      used_by: null,
      note: 'ghi chu giu nguyen',
      assigned_at: '2026-01-02',
    });
  });

  it('"đã thu hồi" mà còn mang tên máy → trống và XOÁ chủ, không để lại hàng lai', async () => {
    expect(await row('reclaimedHybrid')).toMatchObject({
      status: 'free',
      device_id: null,
      used_by: null,
    });
  });

  it('hàng đã ẩn cũng được đổi — "Bật lại" về sau phải ra trạng thái hợp lệ', async () => {
    expect((await row('reclaimedVoided')).status).toBe('free');
  });

  it('hàng vốn đã là trống / đang dùng không bị đụng', async () => {
    expect(await row('assigned')).toMatchObject({ status: 'assigned', used_by: 'Chi Lan' });
    expect((await row('free')).status).toBe('free');
  });

  it('mỗi hàng bị đổi có ĐÚNG một dòng lịch sử, ghi chủ cũ', async () => {
    const { rows } = await scratch.pool.query<{
      ip_address_id: string;
      from_status: string;
      to_status: string;
      changes: { previousUsedBy: string | null; usedBy: string | null };
    }>(
      `SELECT ip_address_id, from_status, to_status, changes FROM ip_history
        WHERE action = 'ip.status_merged'`,
    );
    const byId = new Map(rows.map((r) => [r.ip_address_id, r]));
    expect(rows).toHaveLength(4);
    expect(byId.get(ids.suspect)).toMatchObject({
      from_status: 'suspect_dead',
      to_status: 'assigned',
      changes: { previousUsedBy: 'Phong Ke toan', usedBy: 'Phong Ke toan' },
    });
    expect(byId.get(ids.reclaimedHybrid)).toMatchObject({
      from_status: 'reclaimed',
      to_status: 'free',
      changes: { previousUsedBy: 'Chu cu', usedBy: null },
    });
    expect(byId.has(ids.assigned)).toBe(false);
    expect(byId.has(ids.free)).toBe(false);
  });

  it('dòng lịch sử cũ giữ nguyên tên trạng thái cũ', async () => {
    const { rows } = await scratch.pool.query<{ to_status: string }>(
      `SELECT to_status FROM ip_history WHERE ip_address_id = $1 AND action = 'Thu hồi'`,
      [ids.reclaimed],
    );
    expect(rows).toEqual([{ to_status: 'reclaimed' }]);
  });

  it.each(['suspect_dead', 'reclaimed'])('DB từ chối trạng thái đã bỏ: %s', async (status) => {
    await expect(
      scratch.pool.query(
        `INSERT INTO ip_address (subnet_id, address, status, assigned_by)
         VALUES ($1, '172.30.0.99', $2, $3)`,
        [subnetId, status, ACTOR],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('Vòng đời hai trạng thái trên DB thật', () => {
  let scratch: ScratchDb;
  let addresses: IpAddressService;
  let retirement: IpDeviceRetirement;
  let deviceId: string;
  let subnetId: string;
  /** Địa chỉ mà `IpDeviceRetirement` hỏi sổ NAT — vế thứ hai của phép lọc. */
  let addressesAskedOfNat: string[] = [];

  beforeAll(async () => {
    scratch = await createScratchDb('ims_ip_two_states');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = drizzle(scratch.pool) as unknown as Database;

    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const devices = {
      assertUsableWithin: () => Promise.resolve(),
      getByIds: () => Promise.resolve(new Map()),
    } as unknown as DevicesApiService;
    const subnets = {
      cidrOf: () => Promise.resolve(`172.16.${subnetIndex}.0/24`),
    } as unknown as SubnetService;
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    } as unknown as SystemConfigService;

    addresses = new IpAddressService(db, audit, devices, subnets, config);

    const nat = {
      rulesTouchingDevice: (_tx: unknown, _id: string, list: string[]) => {
        addressesAskedOfNat = list;
        return Promise.resolve([]);
      },
      voidForDeviceWithin: () => Promise.resolve(),
    } as unknown as NatRuleService;
    const registry = { register: () => undefined } as unknown as DeviceRetirementRegistry;
    retirement = new IpDeviceRetirement(registry, addresses, nat);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  /**
   * MỖI BÀI MỘT DẢI RIÊNG, thay cho `DELETE` giữa các bài: `ip_history` là bảng chỉ-thêm và
   * có hàng rào DB chặn thẳng DELETE (AD-13) — bài kiểm không được là ngoại lệ của chính luật
   * nó đang canh.
   */
  let subnetIndex = 0;

  beforeEach(async () => {
    addressesAskedOfNat = [];
    subnetIndex += 1;

    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ($1) RETURNING id`,
      [`PC ${subnetIndex}`],
    );
    const device = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id, status)
       VALUES ($1, 'May ke toan', $2, 'in_use') RETURNING id`,
      [`PC-IP-${subnetIndex}`, type.rows[0].id],
    );
    deviceId = device.rows[0].id;

    const subnet = await scratch.pool.query<{ id: string }>(
      `INSERT INTO subnet (name, cidr, created_by)
       VALUES ($1, $2, $3) RETURNING id`,
      [`Dai kiem IP ${subnetIndex}`, `172.16.${subnetIndex}.0/24`, ACTOR],
    );
    subnetId = subnet.rows[0].id;
  });

  /** Địa chỉ duy nhất của bài đang chạy — dải riêng nên không bao giờ đụng bài khác. */
  function addressOfTest(): string {
    return `172.16.${subnetIndex}.5`;
  }

  async function seedIp(
    status: string,
    owner: { deviceId?: string | null; usedBy?: string | null } = {},
  ): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO ip_address (subnet_id, address, status, device_id, used_by, assigned_by,
                               assigned_at, note)
       VALUES ($1, $2, $3, $4, $5, $6, '2026-01-02', 'camera tang 2') RETURNING id`,
      [subnetId, addressOfTest(), status, owner.deviceId ?? null, owner.usedBy ?? null, ACTOR],
    );
    return rows[0].id;
  }

  async function rowOf(id: string) {
    const { rows } = await scratch.pool.query<{
      status: string;
      device_id: string | null;
      used_by: string | null;
      note: string | null;
    }>(`SELECT status, device_id, used_by, note FROM ip_address WHERE id = $1`, [id]);
    return rows[0];
  }

  describe('Thu hồi: đang dùng → trống', () => {
    it(
      'xoá máy và người dùng, giữ ghi chú',
      async () => {
        const ipId = await seedIp('assigned', { deviceId, usedBy: 'Phong Ke toan' });
        await addresses.transition(ACTOR, ipId, 'free', { reason: 'may hong' });
        expect(await rowOf(ipId)).toEqual({
          status: 'free',
          device_id: null,
          used_by: null,
          note: 'camera tang 2',
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'lịch sử ghi "Thu hồi", ai làm, và chủ CŨ — hồ sơ đã không còn giữ thông tin đó',
      async () => {
        const ipId = await seedIp('assigned', { deviceId, usedBy: 'Phong Ke toan' });
        await addresses.transition(ACTOR, ipId, 'free', { reason: 'may hong' });
        const { rows } = await scratch.pool.query<{
          action: string;
          actor: string;
          from_status: string;
          to_status: string;
          changes: Record<string, unknown>;
        }>(
          `SELECT action, actor, from_status, to_status, changes FROM ip_history
            WHERE ip_address_id = $1`,
          [ipId],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          action: 'Thu hồi',
          actor: ACTOR,
          from_status: 'assigned',
          to_status: 'free',
          changes: {
            reason: 'may hong',
            previousDeviceId: deviceId,
            previousUsedBy: 'Phong Ke toan',
            deviceId: null,
            usedBy: null,
          },
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'thu hồi một IP đang trống bị chặn — không có bước chuyển đứng yên',
      async () => {
        const ipId = await seedIp('free');
        await expect(addresses.transition(ACTOR, ipId, 'free')).rejects.toMatchObject({
          response: { code: 'IP_TRANSITION_INVALID' },
        });
      },
      TEST_TIMEOUT,
    );
  });

  describe('Cấp IP: trống → đang dùng', () => {
    it(
      'nhận chủ mới và ghi ngày cấp',
      async () => {
        const ipId = await seedIp('free');
        await addresses.transition(ACTOR, ipId, 'assigned', { deviceId, usedBy: '  Anh Hung  ' });
        const { rows } = await scratch.pool.query<{ assigned_at: string }>(
          `SELECT assigned_at::text FROM ip_address WHERE id = $1`,
          [ipId],
        );
        expect(await rowOf(ipId)).toMatchObject({
          status: 'assigned',
          device_id: deviceId,
          used_by: 'Anh Hung',
        });
        expect(rows[0].assigned_at).not.toBe('2026-01-02');
      },
      TEST_TIMEOUT,
    );

    it(
      'gán máy qua đường sửa hồ sơ cho một IP trống → thành đang dùng',
      async () => {
        const ipId = await seedIp('free');
        await addresses.update(ACTOR, ipId, { deviceId });
        expect((await rowOf(ipId)).status).toBe('assigned');
        const { rows } = await scratch.pool.query<{ from_status: string; to_status: string }>(
          `SELECT from_status, to_status FROM ip_history
            WHERE ip_address_id = $1 AND action = 'ip.assigned'`,
          [ipId],
        );
        expect(rows).toEqual([{ from_status: 'free', to_status: 'assigned' }]);
      },
      TEST_TIMEOUT,
    );
  });

  describe('thanh lý thiết bị', () => {
    it(
      'IP đang dùng là tài sản đang giữ, và lượt dọn hộ đưa nó về trống',
      async () => {
        const live = await seedIp('assigned', { deviceId, usedBy: 'Phong Ke toan' });
        expect(await retirement.holdingsOf(scratch.db, deviceId)).toEqual([
          `địa chỉ IP ${addressOfTest()}`,
        ]);
        await scratch.db.transaction((tx) => retirement.releaseWithin(tx, ACTOR, deviceId));
        expect(await rowOf(live)).toMatchObject({ status: 'free', device_id: null, used_by: null });
      },
      TEST_TIMEOUT,
    );

    /*
     * Hàng lai "trống mà có tên máy" (A-06): nếu lọt vào danh sách đang giữ thì đường chặn báo
     * `DEVICE_HAS_HOLDINGS`, còn đường dọn gọi `transitionWithin(…, 'free')` lên một hàng đã
     * trống → `IP_TRANSITION_INVALID`, và cả lượt thanh lý rollback.
     */
    it(
      'IP trống mà còn mang device_id KHÔNG phải tài sản đang giữ',
      async () => {
        const stale = await seedIp('free', { deviceId });
        expect(await retirement.holdingsOf(scratch.db, deviceId)).toEqual([]);
        expect(addressesAskedOfNat).toEqual([]);
        await expect(
          scratch.db.transaction((tx) => retirement.releaseWithin(tx, ACTOR, deviceId)),
        ).resolves.toBeUndefined();
        expect((await rowOf(stale)).status).toBe('free');
      },
      TEST_TIMEOUT,
    );
  });
});
