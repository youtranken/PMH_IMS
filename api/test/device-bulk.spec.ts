import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * UX-E25 — thao tác hàng loạt trên Thiết bị, DB thật: MỘT transaction cho cả lô, mỗi máy một dòng
 * lịch sử như làm tay; một máy không hợp lệ (đã thanh lý) thì cả lô không ghi gì.
 */
const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.truc@pmh.com.vn';

describe('Thiết bị — thao tác hàng loạt', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;
  const ids: Record<string, string> = {};
  const audit = { appendWithin: jest.fn().mockResolvedValue(undefined) } as unknown as AuditWriterService;
  const noRetirement = { holdingsWithin: () => Promise.resolve([]), releaseAllWithin: () => Promise.resolve() } as unknown as DeviceRetirementRegistry;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_bulk');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const catalogAudit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    devices = new DevicesService(scratch.db, new CatalogApiService(new CatalogService(scratch.db, catalogAudit)), audit, noRetirement, new DeviceSearchRegistry());
    const type = await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('PC E2E') RETURNING id`);
    for (const [code, status] of [['PC-E2E-1', 'in_use'], ['PC-E2E-2', 'in_use'], ['PC-E2E-OLD', 'retired']]) {
      const row = await scratch.pool.query<{ id: string }>(
        `INSERT INTO device (code, name, device_type_id, status, assigned_to) VALUES ($1, $2, $3, $4, 'An') RETURNING id`,
        [code, code, type.rows[0].id, status],
      );
      ids[code] = row.rows[0].id;
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('đổi người dùng + phòng ban cho nhiều máy: một lượt, mỗi máy một dòng lịch sử "updated"', async () => {
    const result = await devices.bulkUpdate(ACTOR, [ids['PC-E2E-1'], ids['PC-E2E-2']], { assignedTo: 'Bình', department: '' });
    expect(result).toEqual({ updated: 2 });
    const { rows } = await scratch.pool.query(`SELECT code, assigned_to FROM device WHERE code LIKE 'PC-E2E-_' ORDER BY code`);
    expect(rows).toEqual([
      { code: 'PC-E2E-1', assigned_to: 'Bình' },
      { code: 'PC-E2E-2', assigned_to: 'Bình' },
    ]);
    const history = await scratch.pool.query(`SELECT count(*)::int AS n FROM device_history WHERE action = 'updated'`);
    expect(history.rows[0].n).toBe(2);
  });

  it('lô có máy đã thanh lý → từ chối cả lô, không máy nào đổi', async () => {
    await expect(
      devices.bulkUpdate(ACTOR, [ids['PC-E2E-1'], ids['PC-E2E-OLD']], { assignedTo: 'Chi' }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'DEVICE_RETIRED' }) });
    const { rows } = await scratch.pool.query(`SELECT assigned_to FROM device WHERE code = 'PC-E2E-1'`);
    expect(rows[0].assigned_to).toBe('Bình');
  });

  it('đổi trạng thái nhiều máy (Hỏng): một transaction, mỗi máy một dòng "status-changed"', async () => {
    const result = await devices.bulkSetStatus(ACTOR, [ids['PC-E2E-1'], ids['PC-E2E-2']], 'broken');
    expect(result).toEqual({ changed: 2 });
    const { rows } = await scratch.pool.query(`SELECT status FROM device WHERE code LIKE 'PC-E2E-_' ORDER BY code`);
    expect(rows.map((row: { status: string }) => row.status)).toEqual(['broken', 'broken']);
    const history = await scratch.pool.query(`SELECT count(*)::int AS n FROM device_history WHERE action = 'status-changed'`);
    expect(history.rows[0].n).toBe(2);
  });
});
