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
 * Q-15 — "Xóa" hồ sơ IP nhập nhầm là để NHẬP LẠI.
 *
 * Người gõ nhầm (sai chủ, sai ghi chú) xóa hồ sơ rồi khai lại ĐÚNG địa chỉ đó ngay. Ở tầng DB
 * việc này dựa vào `ip_address_key` là UNIQUE một phần (`WHERE voided_at IS NULL`): hàng đã xóa
 * vẫn nằm đó giữ lịch sử, nhưng không được chặn lượt khai mới. Đi qua service thật, không mock
 * drizzle, vì thứ đang kiểm là luật của chỉ mục Postgres.
 *
 * Và hồ sơ đã xóa lẻ không được hiện lại ở đâu trên màn dải — kể cả khi cả dải sau đó bị ngừng
 * dùng (dải ngừng dùng thì hiện các hồ sơ tắt CÙNG nó, để người ta biết máy nào còn cắm IP tĩnh).
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'sa@pmh.com.vn';


describe('Q-15 · xóa hồ sơ IP nhập nhầm rồi nhập lại', () => {
  let scratch: ScratchDb;
  let addresses: IpAddressService;
  let subnetId: string;
  let subnetVoidedAt: Date | null = null;
  // Mỗi bài một dải riêng: `ip_history` là bảng chỉ-thêm (AD-13), không dọn được giữa các bài.
  let round = 0;
  let CIDR = '';
  let ADDRESS = '';
  let SIBLING = '';

  beforeAll(async () => {
    scratch = await createScratchDb('ims_ip_delete_reenter');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = drizzle(scratch.pool) as unknown as Database;
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const devices = {
      assertUsableWithin: () => Promise.resolve(),
      getByIds: () => Promise.resolve(new Map()),
    } as unknown as DevicesApiService;
    const subnets = {
      frameOf: () => Promise.resolve({ cidr: CIDR, voidedAt: subnetVoidedAt }),
      cidrOf: () => Promise.resolve(CIDR),
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
    subnetVoidedAt = null;
    round += 1;
    CIDR = `172.20.${40 + round}.0/29`;
    ADDRESS = `172.20.${40 + round}.3`;
    SIBLING = `172.20.${40 + round}.4`;
    const subnet = await scratch.pool.query<{ id: string }>(
      `INSERT INTO subnet (name, cidr, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [`Dai E2E xoa nhap lai ${round}`, CIDR, ACTOR],
    );
    subnetId = subnet.rows[0].id;
  });

  it(
    'xóa xong nhập lại đúng địa chỉ đó được ngay, và ô hiện hồ sơ MỚI',
    async () => {
      const wrong = await addresses.create(ACTOR, { subnetId, address: ADDRESS, usedBy: 'Chu nham' });
      await addresses.voidAddress(ACTOR, wrong.id, 'go nham chu');

      const right = await addresses.create(ACTOR, { subnetId, address: ADDRESS, usedBy: 'Chu dung' });
      expect(right.id).not.toBe(wrong.id);

      const slot = (await addresses.listBySubnet(subnetId)).find((s) => s.address === ADDRESS);
      expect(slot && 'usedBy' in slot ? slot.usedBy : null).toBe('Chu dung');

      // Lịch sử của hồ sơ đã xóa vẫn còn (AD-13) — xóa khỏi màn, không xóa khỏi sổ.
      const { rows } = await scratch.pool.query<{ action: string }>(
        `SELECT action FROM ip_history WHERE ip_address_id = $1 ORDER BY created_at`,
        [wrong.id],
      );
      expect(rows.map((r) => r.action)).toEqual(['ip.created', 'ip.voided']);
    },
    TEST_TIMEOUT,
  );

  it(
    'xóa rồi nhập lại, xóa tiếp rồi nhập lại lần nữa — không lần nào bị chặn',
    async () => {
      for (const who of ['Lan 1', 'Lan 2']) {
        const row = await addresses.create(ACTOR, { subnetId, address: ADDRESS, usedBy: who });
        await addresses.voidAddress(ACTOR, row.id, `xoa ${who}`);
      }
      const last = await addresses.create(ACTOR, { subnetId, address: ADDRESS, usedBy: 'Lan 3' });
      expect(last.usedBy).toBe('Lan 3');
    },
    TEST_TIMEOUT,
  );

  it(
    'đường hỏng: hồ sơ còn sống thì KHÔNG khai trùng địa chỉ được (chỉ xóa mới nhả chỗ)',
    async () => {
      await addresses.create(ACTOR, { subnetId, address: ADDRESS, usedBy: 'Dang dung' });
      await expect(
        addresses.create(ACTOR, { subnetId, address: ADDRESS, usedBy: 'Nguoi khac' }),
      ).rejects.toMatchObject({ status: 409 });
    },
    TEST_TIMEOUT,
  );

  it(
    'dải ngừng dùng: hiện hồ sơ tắt CÙNG dải, không hiện hồ sơ đã xóa lẻ trước đó',
    async () => {
      const deleted = await addresses.create(ACTOR, { subnetId, address: ADDRESS, usedBy: 'Da xoa' });
      await addresses.voidAddress(ACTOR, deleted.id, 'go nham');

      // Dải ngừng dùng: mọi hồ sơ còn sống tắt theo bằng CÙNG một mốc (xem `SubnetService.voidSubnet`).
      subnetVoidedAt = new Date('2026-09-01T03:00:00Z');
      await scratch.pool.query(
        `INSERT INTO ip_address (subnet_id, address, status, used_by, assigned_by, voided_at, voided_by, void_reason)
         VALUES ($1, $4, 'assigned', 'Theo dai', $2, $3, $2, 'dai cu')`,
        [subnetId, ACTOR, subnetVoidedAt, SIBLING],
      );

      const slots = await addresses.listBySubnet(subnetId);
      const at = (address: string) => slots.find((s) => s.address === address);
      expect(at(SIBLING)?.kind).toBe('record');
      // Hồ sơ đã xóa lẻ không được sống lại trên màn.
      expect(at(ADDRESS)?.kind).toBe('free');
    },
    TEST_TIMEOUT,
  );
});
