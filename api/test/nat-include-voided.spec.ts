import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../src/database/migration-runner';
import type { Database } from '../src/database/database.module';
import { NatRuleService } from '../src/modules/ipam/nat-rule.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { IpAddressService } from '../src/modules/ipam/ip-address.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * NET-037: hộp Gỡ hứa "rule không bị xóa… vẫn tra cứu được". Lời hứa ấy chỉ đúng khi sổ NAT
 * có đường xin CẢ rule đã gỡ, kèm ai gỡ, lúc nào, vì sao.
 */

const TEST_TIMEOUT = 120_000;

describe('Sổ NAT — ?includeVoided=true', () => {
  let scratch: ScratchDb;
  let nat: NatRuleService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_nat_include_voided');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = drizzle(scratch.pool) as unknown as Database;

    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('Router go') RETURNING id`,
    );
    const device = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id, status)
       VALUES ('RT-GO-01', 'Draytek', $1, 'in_use') RETURNING id`,
      [type.rows[0].id],
    );
    const deviceId = device.rows[0].id;
    for (const [port, voided] of [
      [8080, false],
      [8443, true],
    ] as const) {
      await scratch.pool.query(
        `INSERT INTO nat_rule
           (device_id, protocol, external_from, external_to, internal_ip, internal_port,
            used_by, reason, created_by, voided_at, voided_by, void_reason)
         VALUES ($1, 'tcp', $2, $2, '172.16.10.5', 80, 'Phong IT', 'Camera', 'a@pmh.com.vn',
                 $3, $4, $5)`,
        [
          deviceId,
          port,
          voided ? new Date('2026-09-27T03:00:00Z') : null,
          voided ? 'truc@pmh.com.vn' : null,
          voided ? 'dịch vụ đã ngừng' : null,
        ],
      );
    }

    const devices = {
      getByIds: () =>
        Promise.resolve(new Map([[deviceId, { id: deviceId, code: 'RT-GO-01', name: 'x' }]])),
    } as unknown as DevicesApiService;
    const addresses = { findByIds: () => Promise.resolve(new Map()) } as unknown as IpAddressService;
    nat = new NatRuleService(
      db,
      {} as AuditWriterService,
      devices,
      addresses,
      {} as CatalogApiService,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('mặc định chỉ rule đang sống — màn khác và bản xuất cũ không đổi hành vi', async () => {
    const rows = await nat.list();
    expect(rows.map((r) => r.externalPorts)).toEqual(['8080']);
    expect(rows[0]).toMatchObject({ voidedAt: null, voidedBy: null, voidReason: null });
  });

  it('xin thêm thì có cả rule đã gỡ, kèm lúc gỡ, ai gỡ, lý do', async () => {
    const rows = await nat.list({ includeVoided: true });
    expect(rows.map((r) => r.externalPorts)).toEqual(['8080', '8443']);
    expect(rows[1]).toMatchObject({
      voidedBy: 'truc@pmh.com.vn',
      voidReason: 'dịch vụ đã ngừng',
    });
    expect(rows[1].voidedAt).toBeInstanceOf(Date);
  });

  it('tìm kiếm vẫn áp lên rule đã gỡ', async () => {
    const rows = await nat.list({ includeVoided: true, search: '8443' });
    expect(rows.map((r) => r.externalPorts)).toEqual(['8443']);
  });
});
