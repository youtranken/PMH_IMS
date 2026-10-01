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
 * `GET ipam/addresses?search=` — tra "IP này của máy nào" và "máy này giữ những IP nào" xuyên
 * mọi dải, cho ô tra cứu của màn Địa chỉ IP và hộp Tìm nhanh.
 *
 * Tìm máy theo mã/tên đi qua `devices.api` (AD-2) — bài giả nó bằng một bảng nhỏ; phần chạm
 * DB thật là phép lọc địa chỉ, người dùng, dải đã ẩn và hồ sơ đã ẩn.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.truc@pmh.com.vn';

describe('Tìm hồ sơ IP xuyên dải', () => {
  let scratch: ScratchDb;
  let addresses: IpAddressService;
  const device: Record<string, string> = {};

  beforeAll(async () => {
    scratch = await createScratchDb('ims_ip_search');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = drizzle(scratch.pool) as unknown as Database;

    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('Camera tim kiem') RETURNING id`,
    );
    for (const code of ['CAM-TIM-01', 'PC-TIM-02', 'CAM-TIM-03']) {
      const { rows } = await scratch.pool.query<{ id: string }>(
        `INSERT INTO device (code, name, device_type_id, status)
         VALUES ($1, $2, $3, 'in_use') RETURNING id`,
        [code, `Máy ${code}`, type.rows[0].id],
      );
      device[code] = rows[0].id;
    }

    const devices = {
      assertUsableWithin: () => Promise.resolve(),
      search: (term: string) =>
        Promise.resolve(
          Object.entries(device)
            .filter(([code]) => code.toLowerCase().includes(term.toLowerCase()))
            .map(([code, id]) => ({ id, code, name: `Máy ${code}` })),
        ),
      getByIds: (ids: string[]) =>
        Promise.resolve(
          new Map(
            Object.entries(device)
              .filter(([, id]) => ids.includes(id))
              .map(([code, id]) => [
                id,
                { id, code, name: `Máy ${code}`, siteCode: code === 'CAM-TIM-01' ? 'TOWER' : null },
              ]),
          ),
        ),
    } as unknown as DevicesApiService;
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const subnets = {} as unknown as SubnetService;
    const config = {} as unknown as SystemConfigService;
    addresses = new IpAddressService(db, audit, devices, subnets, config);

    const subnet = async (cidr: string, name: string, voided = false): Promise<string> => {
      const { rows } = await scratch.pool.query<{ id: string }>(
        `INSERT INTO subnet (name, cidr, vlan, created_by, voided_at, voided_by, void_reason)
         VALUES ($1, $2, 30, $3, $4, $5, $6) RETURNING id`,
        [name, cidr, ACTOR, voided ? new Date() : null, voided ? ACTOR : null, voided ? 'x' : null],
      );
      return rows[0].id;
    };
    const forbiddenLabel = await subnet('10.77.30.0/28', 'Camera tim');
    const lanSubnet = await subnet('10.77.1.0/24', 'LAN tim');
    const old = await subnet('10.88.0.0/24', 'Dai cu', true);

    const ip = async (
      subnetId: string,
      address: string,
      owner: { device?: string; usedBy?: string; voided?: boolean },
    ): Promise<void> => {
      await scratch.pool.query(
        `INSERT INTO ip_address (subnet_id, address, status, device_id, used_by, assigned_by,
                                 voided_at, voided_by, void_reason)
         VALUES ($1, $2, 'assigned', $3, $4, $5, $6, $7, $8)`,
        [
          subnetId,
          address,
          owner.device ? device[owner.device] : null,
          owner.usedBy ?? null,
          ACTOR,
          owner.voided ? new Date() : null,
          owner.voided ? ACTOR : null,
          owner.voided ? 'nhap nham' : null,
        ],
      );
    };
    await ip(forbiddenLabel, '10.77.30.5', { device: 'CAM-TIM-01' });
    await ip(lanSubnet, '10.77.1.53', { usedBy: 'Chị Bình — Kế toán' });
    await ip(lanSubnet, '10.77.1.54', { device: 'PC-TIM-02', usedBy: 'Cổng phụ' });
    await ip(lanSubnet, '10.77.1.60', { usedBy: 'gõ nhầm', voided: true });
    await ip(old, '10.88.0.9', { device: 'CAM-TIM-03' });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('gõ đủ một IP → đúng hồ sơ đó, kèm dải chứa nó', async () => {
    const hits = await addresses.search('10.77.30.5');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      address: '10.77.30.5',
      deviceCode: 'CAM-TIM-01',
      // Q-20: site lấy từ hồ sơ THIẾT BỊ, không từ dải.
      deviceSiteCode: 'TOWER',
      subnetCidr: '10.77.30.0/28',
      subnetName: 'Camera tim',
      subnetVlan: 30,
    });
  });

  it('gõ dở một IP → mọi hồ sơ bắt đầu bằng phần đã gõ, theo thứ tự địa chỉ', async () => {
    const hits = await addresses.search('10.77.1.');
    expect(hits.map((h) => h.address)).toEqual(['10.77.1.53', '10.77.1.54']);
  });

  it('"10.77.1.5" không khớp nhầm 10.77.1.53 — IP đủ bốn khúc là khớp đúng', async () => {
    expect(await addresses.search('10.77.1.5')).toEqual([]);
  });

  // Một máy một IP (Q-20): CAM-TIM-03 chỉ có IP trong dải đã ẩn nên không hiện.
  it('gõ mã máy → IP của các máy khớp ở dải đang dùng (không lôi dải đã ẩn ra)', async () => {
    const hits = await addresses.search('cam-tim');
    expect(hits.map((h) => h.address)).toEqual(['10.77.30.5']);
    expect((await addresses.search('pc-tim')).map((h) => h.address)).toEqual(['10.77.1.54']);
  });

  it('gõ tên người, không dấu → tìm được, bỏ qua hồ sơ đã ẩn', async () => {
    const hits = await addresses.search('chi binh');
    expect(hits.map((h) => h.address)).toEqual(['10.77.1.53']);
    expect(await addresses.search('go nham')).toEqual([]);
  });

  it('có trần số dòng', async () => {
    expect(await addresses.search('10.77', 1)).toHaveLength(1);
  });
});
