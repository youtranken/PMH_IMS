import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DeviceImportService } from '../src/modules/devices/device-import.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import type { ExcelImportService } from '../src/common/excel/excel-import.service';
import type { ExcelExportService } from '../src/common/excel/excel-export.service';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Vị trí U qua import Excel (Q-23): đối chiếu xét vị trí CUỐI của cả file, nên bước ghi phải làm
 * được đúng điều đó trong MỘT transaction — hoán đổi hai máy, hay A dời vào chỗ B mà B dời đi ở
 * dòng sau. Ghi lần lượt từng dòng thì dòng A va vào B (chưa kịp dời) và cả file bị huỷ, dù bảng
 * đối chiếu báo xanh. `device_rack_u_no_overlap` vẫn là lưới cuối trên DB thật.
 */

const TEST_TIMEOUT = 120_000;
const actor = 'e2e-import-rack@test';
const audit = { appendWithin: () => Promise.resolve(), appendManyWithin: () => Promise.resolve() } as unknown as AuditWriterService;
const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;

type Cells = Record<string, string>;

describe('Import thiết bị · dời chỗ U trong tủ không phụ thuộc thứ tự dòng', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;
  let deviceImport: DeviceImportService;
  let sheet: Cells[] = [];
  let typeId: string;
  let siteId: string;
  let cabinetId: string;
  let n = 0;

  async function one(text: string, params: unknown[] = []): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(text, params);
    return rows[0].id;
  }

  async function uOf(code: string): Promise<number | null> {
    const { rows } = await scratch.pool.query<{ u: number | null }>(`SELECT rack_u_start AS u FROM device WHERE code = $1`, [code]);
    return rows[0].u;
  }

  function file(...rows: Cells[]): Buffer {
    sheet = rows;
    return Buffer.from('');
  }

  const row = (code: string, u: string): Cells => ({
    'Mã thiết bị *': code,
    'Tên thiết bị *': code,
    'Loại *': 'Switch IMP-RACK E2E',
    Site: 'E2E-IMP-RACK',
    'Tủ mạng': 'R01',
    'U bắt đầu': u,
    'Số U': '1',
  });

  async function pair(): Promise<[string, string]> {
    n += 1;
    const a = `E2E-RACK-A${n}`;
    const b = `E2E-RACK-B${n}`;
    const base = n * 10;
    await devices.create(actor, { code: a, name: a, deviceTypeId: typeId, siteId, cabinetId, rackUStart: base + 1, rackUSize: 1 });
    await devices.create(actor, { code: b, name: b, deviceTypeId: typeId, siteId, cabinetId, rackUStart: base + 5, rackUSize: 1 });
    return [a, b];
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_import_rack');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const api = new CatalogApiService(new CatalogService(scratch.db, audit));
    devices = new DevicesService(scratch.db, api, audit, noRetirement, new DeviceSearchRegistry());
    const excelIn = {
      read: () => Promise.resolve({ 'Thiết bị': sheet.map((cells, index) => ({ rowNumber: index + 2, cells })) }),
    } as unknown as ExcelImportService;
    deviceImport = new DeviceImportService(scratch.db, excelIn, {} as ExcelExportService, devices, api, audit);
    siteId = await one(`INSERT INTO site (code, name) VALUES ('E2E-IMP-RACK', 'Site U') RETURNING id`);
    cabinetId = await one(`INSERT INTO cabinet (site_id, code, u_height) VALUES ($1, 'R01', 60) RETURNING id`, [siteId]);
    typeId = await one(`INSERT INTO device_type (name) VALUES ('Switch IMP-RACK E2E') RETURNING id`);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('A dời vào chỗ B ở dòng TRƯỚC, B dời đi ở dòng sau → ghi được cả hai', async () => {
    const [a, b] = await pair();
    const buffer = file(row(a, `${n * 10 + 5}`), row(b, `${n * 10 + 9}`));
    expect((await deviceImport.preview(buffer)).rows.map((r) => r.action)).toEqual(['update', 'update']);
    await expect(deviceImport.commit(actor, buffer)).resolves.toMatchObject({ updated: 2 });
    expect([await uOf(a), await uOf(b)]).toEqual([n * 10 + 5, n * 10 + 9]);
  });

  it('hoán đổi A ↔ B trong một file → ghi được, lịch sử mỗi máy ghi đúng U cũ → mới', async () => {
    const [a, b] = await pair();
    const buffer = file(row(a, `${n * 10 + 5}`), row(b, `${n * 10 + 1}`));
    await expect(deviceImport.commit(actor, buffer)).resolves.toMatchObject({ updated: 2 });
    expect([await uOf(a), await uOf(b)]).toEqual([n * 10 + 5, n * 10 + 1]);
    const { rows } = await scratch.pool.query<{ changes: Record<string, { before: unknown; after: unknown }> }>(
      `SELECT h.changes FROM device_history h JOIN device d ON d.id = h.device_id WHERE d.code = $1 AND h.action = 'imported-update'`,
      [a],
    );
    expect(rows[0].changes.rackUStart).toEqual({ before: n * 10 + 1, after: n * 10 + 5 });
  });

  it('A dời vào chỗ B mà B đứng yên → lỗi ở dòng A, không ghi gì', async () => {
    const [a, b] = await pair();
    const buffer = file(row(a, `${n * 10 + 5}`), row(b, `${n * 10 + 5}`));
    const plan = await deviceImport.preview(buffer);
    expect(plan.rows.map((r) => r.action)).toEqual(['error', 'unchanged']);
    expect(plan.rows[0].message).toMatch(new RegExp(b));
    await expect(deviceImport.commit(actor, buffer)).rejects.toMatchObject({ response: { code: 'DEVICE_IMPORT_HAS_ERRORS' } });
    expect([await uOf(a), await uOf(b)]).toEqual([n * 10 + 1, n * 10 + 5]);
  });
});
