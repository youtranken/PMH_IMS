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
 * Hồ sơ đã thu hồi (Trống) mang "trước: <chủ cũ>" trên bảng dải — đọc từ dòng lịch sử THU HỒI
 * GẦN NHẤT (`changes.previousDeviceId` / `previousUsedBy`), không phải từ hồ sơ (đã gỡ chủ).
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.truc@pmh.com.vn';
const CIDR = '172.20.40.0/29';

describe('Chủ cũ của hồ sơ IP đã thu hồi', () => {
  let scratch: ScratchDb;
  let addresses: IpAddressService;
  let subnetId: string;
  const DEVICE_ID = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    scratch = await createScratchDb('ims_ip_prev_owner');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = drizzle(scratch.pool) as unknown as Database;
    const devices = {
      getByIds: (ids: string[]) =>
        Promise.resolve(
          new Map(
            ids
              .filter((id) => id === DEVICE_ID)
              .map((id) => [id, { id, code: 'PR-E2E-01', name: 'Máy in' }]),
          ),
        ),
    } as unknown as DevicesApiService;
    addresses = new IpAddressService(
      db,
      { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService,
      devices,
      { frameOf: () => Promise.resolve({ cidr: CIDR, voidedAt: null }) } as unknown as SubnetService,
      {} as unknown as SystemConfigService,
    );
    const subnet = await scratch.pool.query<{ id: string }>(
      `INSERT INTO subnet (name, cidr, created_by) VALUES ('Dai chu cu', $1, $2) RETURNING id`,
      [CIDR, ACTOR],
    );
    subnetId = subnet.rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function seed(
    address: string,
    status: string,
    history: { changes: Record<string, unknown>; at: string }[],
  ): Promise<void> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO ip_address (subnet_id, address, status, used_by, assigned_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [subnetId, address, status, status === 'assigned' ? 'Kho' : null, ACTOR],
    );
    for (const entry of history) {
      await scratch.pool.query(
        `INSERT INTO ip_history (ip_address_id, action, actor, from_status, to_status, changes, created_at)
         VALUES ($1, 'ip.reclaimed', $2, 'assigned', 'free', $3, $4)`,
        [rows[0].id, ACTOR, JSON.stringify(entry.changes), entry.at],
      );
    }
  }

  it('thu hồi từ một máy → mã máy; thu hồi hai lần → lần GẦN NHẤT', async () => {
    await seed('172.20.40.2', 'free', [
      { changes: { previousDeviceId: null, previousUsedBy: 'Chị Lan' }, at: '2026-01-01' },
      { changes: { previousDeviceId: DEVICE_ID, previousUsedBy: null }, at: '2026-02-01' },
    ]);
    await seed('172.20.40.3', 'free', [
      { changes: { previousDeviceId: null, previousUsedBy: 'Phòng Kế toán' }, at: '2026-01-05' },
    ]);
    await seed('172.20.40.4', 'assigned', [
      { changes: { previousDeviceId: DEVICE_ID, previousUsedBy: null }, at: '2026-01-05' },
    ]);

    const slots = await addresses.listBySubnet(subnetId);
    const at = (address: string) =>
      slots.find((slot) => slot.address === address) as { previousOwner?: string | null };
    expect(at('172.20.40.2').previousOwner).toBe('PR-E2E-01');
    expect(at('172.20.40.3').previousOwner).toBe('Phòng Kế toán');
    // Đang dùng thì chủ là chủ hiện tại — không kèm "trước".
    expect(at('172.20.40.4').previousOwner ?? null).toBeNull();
  });
});
