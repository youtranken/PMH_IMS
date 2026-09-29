import { runMigrations } from '../src/database/migration-runner';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import { LicenseAssignmentService } from '../src/modules/software/license-assignment.service';
import { SoftwareService } from '../src/modules/software/software.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Bộ lọc danh sách phần mềm (SW-006 · SW-009 · SW-010).
 *
 * - `status=live` = Đang dùng + Hết hạn: mặc định của màn, để hồ sơ Thanh lý không lẫn vào.
 * - `licenseModel` lọc Thuê bao / Vĩnh viễn.
 * - Ô tìm khớp cả máy đang GIỮ ghế (ghế đã gỡ thì không): "máy X đang dùng license nào".
 */

const TEST_TIMEOUT = 120_000;

describe('Danh sách phần mềm · bộ lọc', () => {
  let scratch: ScratchDb;
  let software: SoftwareService;
  let seats: LicenseAssignmentService;
  let deviceA: string;
  let deviceB: string;

  async function one(text: string, params: unknown[] = []): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(text, params);
    return rows[0].id;
  }

  async function sw(code: string, status: string, model = 'subscription'): Promise<string> {
    return one(
      `INSERT INTO software (code, name, kind, license_model, seat_total, end_date, status)
       VALUES ($1, $5, 'license', $3, 5, $4, $2) RETURNING id`,
      [code, status, model, model === 'perpetual' ? null : '2030-01-01', code],
    );
  }

  async function codes(filter: Parameters<SoftwareService['list']>[1]): Promise<string[]> {
    const page = await software.list({ page: 1, limit: 100 }, filter);
    return page.items.map((item) => item.code).sort();
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_sw_filters');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const type = await one(`INSERT INTO device_type (name) VALUES ('PC E2E loc') RETURNING id`);
    deviceA = await one(
      `INSERT INTO device (code, name, device_type_id, status)
       VALUES ('LT-E2E-LOC-A', 'Laptop A', $1, 'in_use') RETURNING id`,
      [type],
    );
    deviceB = await one(
      `INSERT INTO device (code, name, device_type_id, status)
       VALUES ('LT-E2E-LOC-B', 'Laptop B', $1, 'in_use') RETURNING id`,
      [type],
    );

    const active = await sw('LIC-E2E-LOC-ACTIVE', 'active');
    await sw('LIC-E2E-LOC-EXPIRED', 'expired_ok');
    await sw('LIC-E2E-LOC-RETIRED', 'retired');
    const perpetual = await sw('LIC-E2E-LOC-PERP', 'active', 'perpetual');

    await scratch.pool.query(
      `INSERT INTO license_assignment (software_id, device_id, assigned_by) VALUES ($1, $2, 'test')`,
      [active, deviceA],
    );
    // Ghế đã gỡ: máy B TỪNG dùng hồ sơ vĩnh viễn, giờ không còn.
    await scratch.pool.query(
      `INSERT INTO license_assignment (software_id, device_id, assigned_by, released_at, released_by)
       VALUES ($1, $2, 'test', now(), 'test')`,
      [perpetual, deviceB],
    );

    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    } as unknown as SystemConfigService;
    const catalog = {
      lists: () => Promise.resolve({ vendors: [] }),
      validateRefs: () => Promise.resolve([]),
    } as unknown as CatalogApiService;
    software = new SoftwareService(scratch.db, catalog, audit, {} as ExpiryApiService, config);
    // Tìm máy thật trong DB — cùng luật khớp mã với module thiết bị là không cần ở đây.
    const devices = {
      search: async (term: string) => {
        const { rows } = await scratch.pool.query<{ id: string; code: string }>(
          `SELECT id, code FROM device WHERE code ILIKE $1`,
          [`%${term}%`],
        );
        return rows;
      },
    } as unknown as DevicesApiService;
    seats = new LicenseAssignmentService(scratch.db, software, devices);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('status=live: Đang dùng + Hết hạn, không có Thanh lý', async () => {
    expect(await codes({ status: 'live' })).toEqual([
      'LIC-E2E-LOC-ACTIVE',
      'LIC-E2E-LOC-EXPIRED',
      'LIC-E2E-LOC-PERP',
    ]);
  });

  it('licenseModel lọc Vĩnh viễn / Thuê bao', async () => {
    expect(await codes({ licenseModel: 'perpetual' })).toEqual(['LIC-E2E-LOC-PERP']);
    expect(await codes({ licenseModel: 'subscription', status: 'live' })).toEqual([
      'LIC-E2E-LOC-ACTIVE',
      'LIC-E2E-LOC-EXPIRED',
    ]);
  });

  it('ô tìm khớp máy đang giữ ghế, không khớp máy đã gỡ', async () => {
    const onA = await seats.softwareIdsOnDevices('LT-E2E-LOC-A');
    expect(await codes({ search: 'LT-E2E-LOC-A', alsoIds: onA })).toEqual(['LIC-E2E-LOC-ACTIVE']);
    const onB = await seats.softwareIdsOnDevices('LT-E2E-LOC-B');
    expect(onB).toEqual([]);
    expect(await codes({ search: 'LT-E2E-LOC-B', alsoIds: onB })).toEqual([]);
  });

  it('nói được KHỚP MÁY NÀO cho từng hồ sơ — chip "khớp máy X" trên danh sách', async () => {
    const onA = await seats.devicesHoldingSeats('LT-E2E-LOC-A');
    const active = await one(`SELECT id FROM software WHERE code = 'LIC-E2E-LOC-ACTIVE'`);
    expect([...onA.entries()]).toEqual([[active, ['LT-E2E-LOC-A']]]);
    // Ghế đã gỡ thì không "khớp máy".
    expect((await seats.devicesHoldingSeats('LT-E2E-LOC-B')).size).toBe(0);
    // Khớp cả hai máy (chung tiền tố) nhưng chỉ A còn giữ ghế.
    expect([...(await seats.devicesHoldingSeats('LT-E2E-LOC')).values()]).toEqual([
      ['LT-E2E-LOC-A'],
    ]);
  });

  it('ô tìm vẫn khớp mã hồ sơ như cũ', async () => {
    expect(await codes({ search: 'LOC-RETIRED', alsoIds: [] })).toEqual(['LIC-E2E-LOC-RETIRED']);
  });
});
