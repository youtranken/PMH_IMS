import { runMigrations } from '../src/database/migration-runner';
import { NatRuleService } from '../src/modules/ipam/nat-rule.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { IpAddressService } from '../src/modules/ipam/ip-address.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * UX-E25 — dừng một máy chủ có 5–10 luật NAT không còn là 10 lượt bấm: gỡ nhiều luật, MỘT lý do,
 * MỘT transaction; mỗi luật một dòng lịch sử như gỡ tay; một luật đã gỡ rồi thì cả lô không ghi.
 */
const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.truc@pmh.com.vn';

describe('Sổ NAT — gỡ nhiều luật một lượt', () => {
  let scratch: ScratchDb;
  let nat: NatRuleService;
  const ids: number[] = [];
  const rule: Record<number, string> = {};
  const audit = { appendWithin: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    scratch = await createScratchDb('ims_nat_bulk_void');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const type = await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('Router E2E') RETURNING id`);
    const device = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id, status) VALUES ('RT-E2E-BULK', 'Draytek', $1, 'in_use') RETURNING id`,
      [type.rows[0].id],
    );
    for (const port of [8080, 8081, 8082]) {
      const row = await scratch.pool.query<{ id: string }>(
        `INSERT INTO nat_rule (device_id, protocol, external_from, external_to, internal_ip, internal_port, used_by, reason, created_by)
         VALUES ($1, 'tcp', $2, $2, '172.16.10.5', 80, 'IT', 'Camera', 'a@pmh.com.vn') RETURNING id`,
        [device.rows[0].id, port],
      );
      rule[port] = row.rows[0].id;
      ids.push(port);
    }
    nat = new NatRuleService(
      scratch.db,
      audit as unknown as AuditWriterService,
      { getByIds: () => Promise.resolve(new Map()) } as unknown as DevicesApiService,
      { findByIds: () => Promise.resolve(new Map()) } as unknown as IpAddressService,
      {} as CatalogApiService,
      new SystemConfigService(scratch.db),
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('gỡ hai luật một lý do: cả hai mang cùng lý do, mỗi luật một dòng lịch sử', async () => {
    expect(await nat.bulkVoid(ACTOR, [rule[8080], rule[8081]], 'Máy chủ camera ngừng')).toEqual({ voided: 2 });
    const { rows } = await scratch.pool.query(
      `SELECT external_from, void_reason, voided_by FROM nat_rule WHERE voided_at IS NOT NULL ORDER BY external_from`,
    );
    expect(rows).toEqual([
      { external_from: 8080, void_reason: 'Máy chủ camera ngừng', voided_by: ACTOR },
      { external_from: 8081, void_reason: 'Máy chủ camera ngừng', voided_by: ACTOR },
    ]);
  });

  it('lô có luật đã gỡ → từ chối cả lô, luật còn sống không bị gỡ', async () => {
    await expect(nat.bulkVoid(ACTOR, [rule[8082], rule[8080]], 'Thử')).rejects.toBeTruthy();
    const { rows } = await scratch.pool.query(`SELECT voided_at FROM nat_rule WHERE external_from = 8082`);
    expect(rows[0].voided_at).toBeNull();
  });

  it('thiếu lý do → 400, không gỡ gì', async () => {
    await expect(nat.bulkVoid(ACTOR, [rule[8082]], '  ')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VOID_REASON_REQUIRED' }),
    });
  });
});
