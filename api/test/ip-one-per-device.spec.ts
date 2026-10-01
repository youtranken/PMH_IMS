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
 * MỘT THIẾT BỊ GIỮ TỐI ĐA MỘT IP ĐANG CẤP (Q-20).
 *
 * Kiểm ở DB thật vì trọng tài là chỉ mục duy nhất `ip_address_device_uq`: câu kiểm trước của
 * service không chặn được hai lượt cấp chạy song song, và không mock nào diễn lại được luật
 * khoá của Postgres. "Đổi IP" cũng phải ở đây: nó là hai bước ghi trong MỘT transaction, và
 * điều cần kiểm là bước hai hỏng thì bước một phải rollback.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.truc@pmh.com.vn';

describe('Một thiết bị một IP trên DB thật', () => {
  let scratch: ScratchDb;
  let addresses: IpAddressService;
  let audits: { action: string }[] = [];
  let subnetId: string;
  let otherSubnetId: string;
  let deviceId: string;
  let otherDeviceId: string;
  let index = 0;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_ip_one_per_device');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = drizzle(scratch.pool) as unknown as Database;

    const audit = {
      appendWithin: (_tx: unknown, entry: { action: string }) => {
        audits.push(entry);
        return Promise.resolve();
      },
    } as unknown as AuditWriterService;
    const devices = {
      assertUsableWithin: () => Promise.resolve(),
      getByIds: () => Promise.resolve(new Map()),
    } as unknown as DevicesApiService;
    const subnets = {
      cidrOf: (id: string) =>
        Promise.resolve(id === otherSubnetId ? `10.${index}.0.0/24` : `172.17.${index}.0/24`),
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
    audits = [];
    index += 1;
    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ($1) RETURNING id`,
      [`Loai ${index}`],
    );
    const make = async (code: string) =>
      (
        await scratch.pool.query<{ id: string }>(
          `INSERT INTO device (code, name, device_type_id, status)
           VALUES ($1, 'May', $2, 'in_use') RETURNING id`,
          [code, type.rows[0].id],
        )
      ).rows[0].id;
    deviceId = await make(`PC-ONE-${index}`);
    otherDeviceId = await make(`PC-TWO-${index}`);
    const subnet = async (cidr: string) =>
      (
        await scratch.pool.query<{ id: string }>(
          `INSERT INTO subnet (name, cidr, created_by) VALUES ($1, $2, $3) RETURNING id`,
          [`Dai ${cidr}`, cidr, ACTOR],
        )
      ).rows[0].id;
    subnetId = await subnet(`172.17.${index}.0/24`);
    otherSubnetId = await subnet(`10.${index}.0.0/24`);
  });

  const host = (n: number) => `172.17.${index}.${n}`;

  async function liveOf(device: string) {
    const { rows } = await scratch.pool.query<{ address: string; status: string }>(
      `SELECT host(address) AS address, status FROM ip_address
       WHERE device_id = $1 AND voided_at IS NULL ORDER BY address`,
      [device],
    );
    return rows;
  }

  describe('chỉ mục ip_address_device_uq', () => {
    it('chặn hàng ĐANG CẤP thứ hai cho cùng một máy', async () => {
      await scratch.pool.query(
        `INSERT INTO ip_address (subnet_id, address, device_id, assigned_by, status)
         VALUES ($1, $2, $3, $4, 'assigned')`,
        [subnetId, host(5), deviceId, ACTOR],
      );
      await expect(
        scratch.pool.query(
          `INSERT INTO ip_address (subnet_id, address, device_id, assigned_by, status)
           VALUES ($1, $2, $3, $4, 'assigned')`,
          [subnetId, host(6), deviceId, ACTOR],
        ),
      ).rejects.toMatchObject({ code: '23505', constraint: 'ip_address_device_uq' });
    });

    it('không ràng hồ sơ Trống, hồ sơ đã ẩn, hay IP gán cho người (không có máy)', async () => {
      await scratch.pool.query(
        `INSERT INTO ip_address (subnet_id, address, device_id, assigned_by, status)
         VALUES ($1, $2, $3, $4, 'assigned')`,
        [subnetId, host(5), deviceId, ACTOR],
      );
      await scratch.pool.query(
        `INSERT INTO ip_address (subnet_id, address, device_id, assigned_by, status)
         VALUES ($1, $2, $3, $4, 'free')`,
        [subnetId, host(6), deviceId, ACTOR],
      );
      await scratch.pool.query(
        `INSERT INTO ip_address (subnet_id, address, device_id, assigned_by, status,
                                 voided_at, voided_by, void_reason)
         VALUES ($1, $2, $3, $4, 'assigned', now(), $4, 'nhap nham')`,
        [subnetId, host(7), deviceId, ACTOR],
      );
      await scratch.pool.query(
        `INSERT INTO ip_address (subnet_id, address, used_by, assigned_by, status)
         VALUES ($1, $2, 'Ke toan', $3, 'assigned'), ($1, $4, 'Ke toan', $3, 'assigned')`,
        [subnetId, host(8), ACTOR, host(9)],
      );
    });
  });

  describe('mọi đường ghi trả 409 DEVICE_HAS_IP nói rõ IP đang giữ', () => {
    beforeEach(async () => {
      await addresses.create(ACTOR, { subnetId, address: host(5), deviceId });
    });

    it('tạo hồ sơ mới cho máy đã có IP', async () => {
      await expect(
        addresses.create(ACTOR, { subnetId, address: host(6), deviceId }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'DEVICE_HAS_IP', message: expect.stringContaining(host(5)) },
      });
      expect(await liveOf(deviceId)).toHaveLength(1);
    });

    it('cấp lại một hồ sơ Trống cho máy đã có IP', async () => {
      const free = await addresses.create(ACTOR, { subnetId, address: host(6), usedBy: 'Tam' });
      await addresses.transition(ACTOR, free.id, 'free');
      await expect(
        addresses.transition(ACTOR, free.id, 'assigned', { deviceId }),
      ).rejects.toMatchObject({ status: 409, response: { code: 'DEVICE_HAS_IP' } });
    });

    it('sửa hồ sơ đang dùng của máy khác sang máy đã có IP', async () => {
      const other = await addresses.create(ACTOR, {
        subnetId,
        address: host(6),
        deviceId: otherDeviceId,
      });
      await expect(
        addresses.update(ACTOR, other.id, { deviceId }),
      ).rejects.toMatchObject({ status: 409, response: { code: 'DEVICE_HAS_IP' } });
    });

    it('vẫn sửa được ghi chú trên chính hồ sơ IP của máy (không tự đụng chính mình)', async () => {
      const [mine] = await addresses.listForDevice(deviceId);
      await expect(
        addresses.update(ACTOR, mine.id, { deviceId, note: 'cong 3' }),
      ).resolves.toMatchObject({ note: 'cong 3' });
    });
  });

  it('hai lượt cấp song song cho cùng một máy: đúng một lượt thắng, lượt kia 409', async () => {
    const results = await Promise.allSettled([
      addresses.create(ACTOR, { subnetId, address: host(10), deviceId }),
      addresses.create(ACTOR, { subnetId, address: host(11), deviceId }),
      addresses.create(ACTOR, { subnetId, address: host(12), deviceId }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(2);
    for (const f of failed) {
      expect(f.reason).toMatchObject({ status: 409, response: { code: 'DEVICE_HAS_IP' } });
    }
    expect(await liveOf(deviceId)).toHaveLength(1);
  });

  /**
   * Cuộc đua dựng TẤT ĐỊNH: một lượt cấp khác đã ghi nhưng chưa commit, nên câu kiểm trước của
   * service không thấy nó. Chỉ chỉ mục chặn được — bỏ migration 0037 thì bài này đỏ.
   */
  it('lượt cấp chen vào khi lượt kia chưa commit: chỉ mục chặn, trả 409 chứ không 500', async () => {
    const client = await scratch.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ip_address (subnet_id, address, device_id, assigned_by, status)
         VALUES ($1, $2, $3, $4, 'assigned')`,
        [subnetId, host(20), deviceId, ACTOR],
      );
      const pending = addresses.create(ACTOR, { subnetId, address: host(21), deviceId });
      const settled = pending.then(
        () => 'ok',
        (error: unknown) => error,
      );
      // Chờ tới khi lượt của service đang đứng đợi khoá của chỉ mục rồi mới commit.
      for (let i = 0; i < 100; i += 1) {
        const { rows } = await scratch.pool.query<{ n: string }>(
          `SELECT count(*) AS n FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if (Number(rows[0].n) > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await client.query('COMMIT');
      expect(await settled).toMatchObject({ status: 409, response: { code: 'DEVICE_HAS_IP' } });
    } finally {
      client.release();
    }
    expect(await liveOf(deviceId)).toEqual([{ address: host(20), status: 'assigned' }]);
  });

  describe('Đổi IP — thu hồi cũ + cấp mới trong MỘT transaction', () => {
    let currentId: string;

    beforeEach(async () => {
      currentId = (await addresses.create(ACTOR, { subnetId, address: host(5), deviceId })).id;
    });

    it('sang một ô chưa có hồ sơ ở dải khác: IP cũ về pool, máy giữ đúng IP mới', async () => {
      const next = await addresses.changeAddress(ACTOR, currentId, {
        subnetId: otherSubnetId,
        address: `10.${index}.0.20`,
        reason: 'chuyen VLAN',
      });
      expect(next).toMatchObject({ address: `10.${index}.0.20`, deviceId, status: 'assigned' });
      expect(await liveOf(deviceId)).toEqual([
        { address: `10.${index}.0.20`, status: 'assigned' },
      ]);
      const old = await scratch.pool.query<{ status: string; device_id: string | null }>(
        `SELECT status, device_id FROM ip_address WHERE id = $1`,
        [currentId],
      );
      expect(old.rows[0]).toEqual({ status: 'free', device_id: null });
      // Dòng thu hồi giữ chủ cũ — "IP này từng của máy nào" vẫn trả lời được.
      const history = await scratch.pool.query<{ action: string; changes: Record<string, unknown> }>(
        `SELECT action, changes FROM ip_history WHERE ip_address_id = $1 ORDER BY created_at`,
        [currentId],
      );
      expect(history.rows.at(-1)).toMatchObject({
        action: 'Thu hồi',
        changes: { previousDeviceId: deviceId },
      });
      expect(audits.map((a) => a.action)).toContain('ip.changed');
    });

    it('sang một hồ sơ đang Trống: cấp lại chính hồ sơ đó, không đẻ hồ sơ mới', async () => {
      const freed = await addresses.create(ACTOR, { subnetId, address: host(9), usedBy: 'Tam' });
      await addresses.transition(ACTOR, freed.id, 'free');
      const next = await addresses.changeAddress(ACTOR, currentId, {
        subnetId,
        address: host(9),
      });
      expect(next.id).toBe(freed.id);
      expect(await liveOf(deviceId)).toEqual([{ address: host(9), status: 'assigned' }]);
    });

    it('IP mới đã có người dùng: từ chối và IP cũ VẪN của máy (rollback cả lượt)', async () => {
      await addresses.create(ACTOR, { subnetId, address: host(9), deviceId: otherDeviceId });
      await expect(
        addresses.changeAddress(ACTOR, currentId, { subnetId, address: host(9) }),
      ).rejects.toMatchObject({ status: 409, response: { code: 'IP_TAKEN' } });
      expect(await liveOf(deviceId)).toEqual([{ address: host(5), status: 'assigned' }]);
      const history = await scratch.pool.query(
        `SELECT 1 FROM ip_history WHERE ip_address_id = $1 AND action = 'Thu hồi'`,
        [currentId],
      );
      expect(history.rowCount).toBe(0);
    });

    it('người/bộ phận và ghi chú của IP cũ đi theo máy sang IP mới khi không gửi giá trị mới', async () => {
      const held = await addresses.create(ACTOR, {
        subnetId,
        address: host(40),
        deviceId: otherDeviceId,
        usedBy: 'Phong Ke toan',
        note: 'Cong 3 switch tang 2',
      });
      const carried = await addresses.changeAddress(ACTOR, held.id, {
        subnetId: otherSubnetId,
        address: `10.${index}.0.40`,
      });
      expect(carried).toMatchObject({ usedBy: 'Phong Ke toan', note: 'Cong 3 switch tang 2' });

      const replaced = await addresses.changeAddress(ACTOR, carried.id, {
        subnetId: otherSubnetId,
        address: `10.${index}.0.41`,
        usedBy: 'Phong Nhan su',
        note: '',
      });
      expect(replaced).toMatchObject({ usedBy: 'Phong Nhan su', note: null });
    });

    it('đổi sang chính địa chỉ đang giữ là lỗi 400, không ghi gì', async () => {
      await expect(
        addresses.changeAddress(ACTOR, currentId, { subnetId, address: host(5) }),
      ).rejects.toMatchObject({ status: 400, response: { code: 'IP_CHANGE_SAME' } });
    });

    it('hồ sơ không gắn máy thì không có "Đổi IP"', async () => {
      const person = await addresses.create(ACTOR, { subnetId, address: host(30), usedBy: 'Tam' });
      await expect(
        addresses.changeAddress(ACTOR, person.id, { subnetId, address: host(31) }),
      ).rejects.toMatchObject({ status: 400, response: { code: 'IP_CHANGE_NEEDS_DEVICE' } });
    });
  });
});
