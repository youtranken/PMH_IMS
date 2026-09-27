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
 * BE-09 · BE-13 — sửa, gia hạn và gán ghế phải xét ghế đang gán và trạng thái Thanh lý.
 *
 * Luật thuần đã có bảng (`seatConflicts` trong software-rules.spec). Bài này hỏi phần chỉ
 * Postgres trả lời được: đếm ghế trên hàng ĐÃ KHÓA trong transaction ghi, và đọc trạng thái
 * Thanh lý từ hàng khóa `FOR UPDATE` của lượt gán chứ không từ ảnh chụp trước đó.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'sa@pmh.com.vn';

type Failure = { status?: number; code?: string };

async function failure(action: Promise<unknown>): Promise<Failure | null> {
  return action.then(
    () => null,
    (error: unknown) => {
      const e = error as { getStatus?: () => number; getResponse?: () => { code?: string } };
      return { status: e.getStatus?.(), code: e.getResponse?.()?.code };
    },
  );
}

describe('BE-09 · BE-13 · hồ sơ phần mềm và ghế đang gán', () => {
  let scratch: ScratchDb;
  let software: SoftwareService;
  let seats: LicenseAssignmentService;
  let deviceIds: string[];

  async function one(text: string, params: unknown[] = []): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(text, params);
    return rows[0].id;
  }

  /** License 3 ghế, gán sẵn `used` máy; `endDated` ghế đầu có ngày hết hạn. */
  async function license(code: string, used: number, endDated = 0): Promise<string> {
    const id = await one(
      `INSERT INTO software (code, name, kind, license_model, seat_total, end_date, status)
       VALUES ($1, $2, 'license', 'subscription', 3, '2030-01-01', 'active') RETURNING id`,
      [code, code],
    );
    for (let i = 0; i < used; i += 1) {
      await scratch.pool.query(
        `INSERT INTO license_assignment (software_id, device_id, assigned_by, end_date)
         VALUES ($1, $2, 'test', $3)`,
        [id, deviceIds[i], i < endDated ? '2029-01-01' : null],
      );
    }
    return id;
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_sw_seats');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const type = await one(`INSERT INTO device_type (name) VALUES ('PC E2E ghe') RETURNING id`);
    deviceIds = [];
    for (let i = 0; i < 4; i += 1) {
      deviceIds.push(
        await one(
          `INSERT INTO device (code, name, device_type_id, status)
           VALUES ($1, $3, $2, 'in_use') RETURNING id`,
          [`PC-E2E-GHE-${i}`, type, `PC ${i}`],
        ),
      );
    }
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    } as unknown as SystemConfigService;
    const catalog = {
      lists: () => Promise.resolve({ vendors: [] }),
      validateRefs: () => Promise.resolve([]),
    } as unknown as CatalogApiService;
    const expiry = {
      recordRenewalWithin: () => Promise.resolve(),
    } as unknown as ExpiryApiService;
    software = new SoftwareService(scratch.db, catalog, audit, expiry, config);
    const devices = {
      assertUsableWithin: () => Promise.resolve(),
      getByIds: () => Promise.resolve(new Map()),
    } as unknown as DevicesApiService;
    seats = new LicenseAssignmentService(scratch.db, software, devices);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  describe('BE-09 · sửa hồ sơ đang có ghế', () => {
    it.each([
      ['đổi sang SSL', { kind: 'ssl', seatTotal: null }],
      ['hạ tổng seat dưới số đang dùng', { seatTotal: 1 }],
      ['chuyển vĩnh viễn khi ghế còn hạn', { licenseModel: 'perpetual', endDate: null }],
    ])('%s → 409 SOFTWARE_SEATS_IN_USE', async (_name, patch) => {
      const id = await license(`LIC-E2E-${Math.random().toString(36).slice(2, 8)}`, 2, 1);
      expect(await failure(software.update(ACTOR, id, patch as never))).toEqual({
        status: 409,
        code: 'SOFTWARE_SEATS_IN_USE',
      });
    });

    it.each([
      ['hạ seat đúng bằng số đang dùng', { seatTotal: 2 }],
      ['đổi tên', { name: 'Tên mới' }],
    ])('%s → được', async (_name, patch) => {
      const id = await license(`LIC-E2E-${Math.random().toString(36).slice(2, 8)}`, 2, 1);
      expect(await failure(software.update(ACTOR, id, patch as never))).toBeNull();
    });

    it('thanh lý khi còn ghế: tự gỡ mọi ghế, mỗi ghế một dòng lịch sử (Q-03)', async () => {
      const id = await license('LIC-E2E-THANHLY', 2, 1);
      expect(await failure(software.update(ACTOR, id, { status: 'retired' } as never))).toBeNull();
      const open = await scratch.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM license_assignment WHERE software_id = $1 AND released_at IS NULL`,
        [id],
      );
      expect(open.rows[0].n).toBe(0);
      const hist = await scratch.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM software_history WHERE software_id = $1 AND action = 'license-released'`,
        [id],
      );
      expect(hist.rows[0].n).toBe(2); // hai ghế đang gán → hai dòng
    });

    it('không còn ghế thì thanh lý được', async () => {
      const id = await license('LIC-E2E-TRONG', 0);
      expect(await failure(software.update(ACTOR, id, { status: 'retired' } as never))).toBeNull();
    });
  });

  describe('BE-09 · gán ghế vào hồ sơ đã thanh lý', () => {
    it('hồ sơ Thanh lý → 409 SOFTWARE_RETIRED, không có dòng gán nào', async () => {
      const id = await license('LIC-E2E-DA-TL', 0);
      await scratch.pool.query(`UPDATE software SET status = 'retired' WHERE id = $1`, [id]);
      expect(await failure(seats.assign(ACTOR, id, { deviceId: deviceIds[3] }))).toEqual({
        status: 409,
        code: 'SOFTWARE_RETIRED',
      });
      const { rows } = await scratch.pool.query(
        `SELECT count(*)::int AS n FROM license_assignment WHERE software_id = $1`,
        [id],
      );
      expect(rows[0].n).toBe(0);
    });
  });

  describe('BE-13 · gia hạn hồ sơ đã thanh lý', () => {
    it('→ 409 SOFTWARE_RETIRED, vẫn Thanh lý, hạn không đổi', async () => {
      const id = await license('LIC-E2E-GH-TL', 0);
      await scratch.pool.query(`UPDATE software SET status = 'retired' WHERE id = $1`, [id]);
      expect(await failure(software.renew(ACTOR, id, '2031-01-01'))).toEqual({
        status: 409,
        code: 'SOFTWARE_RETIRED',
      });
      const { rows } = await scratch.pool.query(
        `SELECT status, end_date::text AS end FROM software WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({ status: 'retired', end: '2030-01-01' });
    });
  });
});
