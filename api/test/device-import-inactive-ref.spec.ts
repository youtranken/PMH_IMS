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
 * Q-14 (DEV-027) ở cửa Excel — mục danh mục đã vô hiệu không chọn MỚI được qua import.
 *
 * Cửa HTTP đã chặn (`catalog-inactive-ref.spec.ts`). Import ghi qua `insertWithin` /
 * `updateWithin`, đối chiếu bằng `snapshot()` gồm cả mục đã vô hiệu, nên file Excel là cửa sau
 * của đúng luật đó. Lỗi phải hiện THEO DÒNG ở bước Đối chiếu (cả file là một transaction —
 * ném lúc ghi thì không ai biết dòng nào hỏng), và bước ghi phải từ chối, không ghi gì.
 *
 * Vế còn lại y như cửa HTTP: máy VỐN trỏ vào mục đã vô hiệu vẫn nhập lại/sửa được ô khác.
 */

const TEST_TIMEOUT = 120_000;
const actor = 'import-inactive@test';
const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;

type Cells = Record<string, string>;

describe('Q-14 · import thiết bị không chọn mới mục danh mục đã vô hiệu', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;
  let deviceImport: DeviceImportService;
  let sheet: Cells[] = [];

  async function one(text: string, params: unknown[] = []): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(text, params);
    return rows[0].id;
  }

  async function deviceByCode(code: string) {
    const { rows } = await scratch.pool.query<{ name: string; device_type_id: string }>(
      `SELECT name, device_type_id FROM device WHERE code = $1`,
      [code],
    );
    return rows[0] ?? null;
  }

  function file(...rows: Cells[]): Buffer {
    sheet = rows;
    return Buffer.from('');
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_import_inactive');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const api = new CatalogApiService(new CatalogService(scratch.db, audit));
    devices = new DevicesService(scratch.db, api, audit, noRetirement, new DeviceSearchRegistry());
    const excelIn = {
      read: () =>
        Promise.resolve({
          'Thiết bị': sheet.map((cells, index) => ({ rowNumber: index + 2, cells })),
        }),
    } as unknown as ExcelImportService;
    deviceImport = new DeviceImportService(
      scratch.db,
      excelIn,
      {} as ExcelExportService,
      devices,
      api,
      audit,
    );

    const siteOn = await one(
      `INSERT INTO site (code, name) VALUES ('E2E-IMP-ON', 'Dùng') RETURNING id`,
    );
    const siteOff = await one(
      `INSERT INTO site (code, name) VALUES ('E2E-IMP-OFF', 'Cũ') RETURNING id`,
    );
    await one(`INSERT INTO cabinet (site_id, code) VALUES ($1, 'R01') RETURNING id`, [siteOn]);
    const cabOff = await one(
      `INSERT INTO cabinet (site_id, code) VALUES ($1, 'R02') RETURNING id`,
      [siteOn],
    );
    const typeOn = await one(`INSERT INTO device_type (name) VALUES ('PC IMP E2E') RETURNING id`);
    const typeOff = await one(`INSERT INTO device_type (name) VALUES ('Fax IMP E2E') RETURNING id`);
    await one(`INSERT INTO vendor (name) VALUES ('NCC IMP E2E') RETURNING id`);
    const vendorOff = await one(`INSERT INTO vendor (name) VALUES ('NCC cũ IMP E2E') RETURNING id`);

    // Hồ sơ cũ dựng khi mục còn dùng, rồi mới vô hiệu — đúng như đời thực.
    await devices.create(actor, {
      code: 'E2E-IMP-OLD',
      name: 'Máy cũ',
      deviceTypeId: typeOff,
      siteId: siteOff,
      vendorId: vendorOff,
    });
    await devices.create(actor, { code: 'E2E-IMP-MOVE', name: 'Máy dời', deviceTypeId: typeOn });

    for (const [table, rowId] of [
      ['site', siteOff],
      ['cabinet', cabOff],
      ['device_type', typeOff],
      ['vendor', vendorOff],
    ]) {
      await scratch.pool.query(`UPDATE ${table} SET active = false WHERE id = $1`, [rowId]);
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it.each([
    ['loại', { 'Loại *': 'Fax IMP E2E' }, /Loại thiết bị "Fax IMP E2E" đã ngừng dùng/],
    ['site', { 'Loại *': 'PC IMP E2E', Site: 'E2E-IMP-OFF' }, /Site "E2E-IMP-OFF" đã ngừng dùng/],
    [
      'tủ',
      { 'Loại *': 'PC IMP E2E', Site: 'E2E-IMP-ON', 'Tủ mạng': 'R02' },
      /Tủ mạng "R02" đã ngừng dùng/,
    ],
    [
      'nhà cung cấp',
      { 'Loại *': 'PC IMP E2E', 'Nhà cung cấp': 'NCC cũ IMP E2E' },
      /Nhà cung cấp "NCC cũ IMP E2E" đã ngừng dùng/,
    ],
  ])(
    'dòng TẠO MỚI trỏ vào %s đã vô hiệu → lỗi theo dòng ở Đối chiếu, commit không ghi',
    async (label, refs, message) => {
      const code = `E2E-IMP-NEW-${label.replace(/\s/g, '')}`;
      const buffer = file({ 'Mã thiết bị *': code, 'Tên thiết bị *': 'Máy mới', ...refs });

      const plan = await deviceImport.preview(buffer);
      expect(plan.rows).toHaveLength(1);
      expect(plan.rows[0]).toMatchObject({ rowNumber: 2, action: 'error' });
      expect(plan.rows[0].message).toMatch(message);
      expect(plan.summary).toMatchObject({ error: 1, create: 0 });

      await expect(deviceImport.commit(actor, buffer)).rejects.toMatchObject({
        response: { code: 'DEVICE_IMPORT_HAS_ERRORS' },
      });
      expect(await deviceByCode(code)).toBeNull();
    },
    TEST_TIMEOUT,
  );

  it('dòng SỬA đổi máy sang loại đã vô hiệu → lỗi theo dòng, hồ sơ giữ nguyên', async () => {
    const buffer = file({
      'Mã thiết bị *': 'E2E-IMP-MOVE',
      'Tên thiết bị *': 'Máy dời',
      'Loại *': 'Fax IMP E2E',
    });
    const plan = await deviceImport.preview(buffer);
    expect(plan.rows[0]).toMatchObject({ action: 'error' });
    expect(plan.rows[0].message).toMatch(/Loại thiết bị "Fax IMP E2E" đã ngừng dùng/);
    await expect(deviceImport.commit(actor, buffer)).rejects.toMatchObject({
      response: { code: 'DEVICE_IMPORT_HAS_ERRORS' },
    });
    const row = await deviceByCode('E2E-IMP-MOVE');
    const typeOn = await one(`SELECT id FROM device_type WHERE name = 'PC IMP E2E'`);
    expect(row?.device_type_id).toBe(typeOn);
  });

  it('máy VỐN trỏ vào mục đã vô hiệu: nhập lại đủ cột, chỉ đổi tên → vẫn ghi được', async () => {
    const buffer = file({
      'Mã thiết bị *': 'E2E-IMP-OLD',
      'Tên thiết bị *': 'Máy cũ — đổi tên',
      'Loại *': 'Fax IMP E2E',
      Site: 'E2E-IMP-OFF',
      'Nhà cung cấp': 'NCC cũ IMP E2E',
    });
    const plan = await deviceImport.preview(buffer);
    expect(plan.rows[0]).toMatchObject({ action: 'update' });

    const result = await deviceImport.commit(actor, buffer);
    expect(result).toMatchObject({ updated: 1, created: 0 });
    expect((await deviceByCode('E2E-IMP-OLD'))?.name).toBe('Máy cũ — đổi tên');
  });

  it('đối chứng: dòng mới trỏ vào mục còn dùng thì tạo được, cùng file với dòng lỗi thì không', async () => {
    const good = {
      'Mã thiết bị *': 'E2E-IMP-OK',
      'Tên thiết bị *': 'Máy tốt',
      'Loại *': 'PC IMP E2E',
    };
    const plan = await deviceImport.preview(
      file(good, {
        'Mã thiết bị *': 'E2E-IMP-BAD',
        'Tên thiết bị *': 'Máy xấu',
        'Loại *': 'Fax IMP E2E',
      }),
    );
    expect(plan.rows.map((row) => row.action)).toEqual(['create', 'error']);
    expect(plan.summary).toMatchObject({ create: 1, error: 1 });

    const result = await deviceImport.commit(actor, file(good));
    expect(result).toMatchObject({ created: 1 });
    expect(await deviceByCode('E2E-IMP-OK')).not.toBeNull();
  });
});
