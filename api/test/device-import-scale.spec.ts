import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DeviceImportService } from '../src/modules/devices/device-import.service';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import type { ExcelImportService } from '../src/common/excel/excel-import.service';
import type { ExcelExportService } from '../src/common/excel/excel-export.service';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';


/**
 * Import thiết bị ở quy mô thật: một transaction cho cả file, ghi từng dòng một thì 5.000 dòng mất
 * 20–30 giây và file 20.000 dòng (trần) vượt timeout của nginx (Q-29). Ngưỡng ở đây đủ rộng cho máy
 * chậm hơn nhưng vẫn bắt được kiểu ghi lần lượt từng dòng. Kèm kiểm đúng: ghi theo lô không được rơi
 * dòng lịch sử / nhật ký nào.
 */

const TEST_TIMEOUT = 600_000;
const actor = 'import-scale@test';
const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;

const ROWS = 5_000;
const MAX_MS = 15_000;

describe('import thiết bị ở quy mô go-live', () => {
  let scratch: ScratchDb;
  let deviceImport: DeviceImportService;
  let sheet: Record<string, string>[] = [];

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_import_scale');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    // Audit THẬT: số đo phải gồm cả dòng nhật ký của mỗi máy.
    const audit = new AuditWriterService(scratch.db);
    const api = new CatalogApiService(new CatalogService(scratch.db, audit));
    const devices = new DevicesService(scratch.db, api, audit, noRetirement, new DeviceSearchRegistry());
    const excelIn = {
      read: () => Promise.resolve({ 'Thiết bị': sheet.map((cells, index) => ({ rowNumber: index + 2, cells })) }),
    } as unknown as ExcelImportService;
    deviceImport = new DeviceImportService(scratch.db, excelIn, {} as ExcelExportService, devices, api, audit);
    await scratch.pool.query(`INSERT INTO device_type (name) VALUES ('PC SCALE E2E')`);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function count(sql: string): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: number }>(sql);
    return rows[0].n;
  }

  it(`${ROWS} dòng tạo mới rồi ${ROWS} dòng sửa, mỗi lượt dưới ${MAX_MS / 1000} giây, đủ lịch sử và nhật ký`, async () => {
    sheet = Array.from({ length: ROWS }, (_v, i) => ({ 'Mã thiết bị *': `E2E-SC-${i}`, 'Tên thiết bị *': `Máy ${i}`, 'Loại *': 'PC SCALE E2E' }));
    let started = Date.now();
    expect(await deviceImport.commit(actor, Buffer.from(''))).toMatchObject({ created: ROWS, updated: 0 });
    const create = Date.now() - started;

    sheet = sheet.map((c) => ({ ...c, 'Tên thiết bị *': `${c['Tên thiết bị *']} sửa` }));
    started = Date.now();
    expect(await deviceImport.commit(actor, Buffer.from(''))).toMatchObject({ created: 0, updated: ROWS });
    const update = Date.now() - started;

    expect(await count(`SELECT count(*)::int AS n FROM device WHERE name LIKE '% sửa'`)).toBe(ROWS);
    expect(await count(`SELECT count(*)::int AS n FROM device_history WHERE action = 'imported'`)).toBe(ROWS);
    expect(await count(`SELECT count(*)::int AS n FROM device_history WHERE action = 'imported-update' AND changes ? 'name'`)).toBe(ROWS);
    expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action IN ('device.imported', 'device.imported-update') AND object_id IS NOT NULL`)).toBe(2 * ROWS);
    expect({ create: create < MAX_MS, update: update < MAX_MS, create_ms: create, update_ms: update }).toMatchObject({ create: true, update: true });
  }, TEST_TIMEOUT);
});
