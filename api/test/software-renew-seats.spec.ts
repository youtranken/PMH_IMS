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
 * SW-049 — gia hạn hồ sơ kéo luôn các ghế có kỳ hạn riêng, TRONG CÙNG transaction.
 *
 * Không có nó thì license đã gia hạn mà ghế vẫn giữ ngày cũ và hiện "Quá hạn". Chỉ ghế CÒN
 * HIỆU LỰC, CÓ ngày riêng và ngày đó TRƯỚC hạn mới mới được kéo — ghế đã gỡ là dấu vết kiểm
 * toán, ghế dài hạn hơn thì không bị rút ngắn.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'sa@pmh.com.vn';

describe('SW-049 · gia hạn hồ sơ kèm ghế có kỳ hạn riêng', () => {
  let scratch: ScratchDb;
  let software: SoftwareService;
  let seats: LicenseAssignmentService;
  let deviceIds: string[];
  let round = 0;

  async function one(text: string, params: unknown[] = []): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(text, params);
    return rows[0].id;
  }

  /** License hạn 2026-12-31; ghế: [0] riêng 2026-12-31, [1] không ngày riêng, [2] riêng 2030, [3] đã gỡ. */
  async function license(): Promise<string> {
    round += 1;
    const id = await one(
      `INSERT INTO software (code, name, kind, license_model, seat_total, end_date, status)
       VALUES ($1, 'Office', 'license', 'subscription', 5, '2026-12-31', 'active') RETURNING id`,
      [`LIC-E2E-GH-${round}`],
    );
    const ends = ['2026-12-31', null, '2030-01-01', '2026-12-31'];
    for (let i = 0; i < 4; i += 1) {
      await scratch.pool.query(
        `INSERT INTO license_assignment (software_id, device_id, assigned_by, end_date, released_at, released_by)
         VALUES ($1, $2, 'test', $3, $4, $5)`,
        [id, deviceIds[i], ends[i], i === 3 ? new Date() : null, i === 3 ? 'test' : null],
      );
    }
    return id;
  }

  async function seatEnds(id: string): Promise<(string | null)[]> {
    const { rows } = await scratch.pool.query<{ end_date: string | null }>(
      `SELECT to_char(end_date, 'YYYY-MM-DD') AS end_date FROM license_assignment
       WHERE software_id = $1 ORDER BY (SELECT code FROM device WHERE id = device_id)`,
      [id],
    );
    return rows.map((row) => row.end_date);
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_sw_renew_seats');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const type = await one(`INSERT INTO device_type (name) VALUES ('PC E2E gh') RETURNING id`);
    deviceIds = [];
    for (let i = 0; i < 4; i += 1) {
      deviceIds.push(
        await one(
          `INSERT INTO device (code, name, device_type_id, status)
           VALUES ($1, $3, $2, 'in_use') RETURNING id`,
          [`PC-E2E-GH-${i}`, type, `PC ${i}`],
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
      assertRefs: () => Promise.resolve(),
    } as unknown as CatalogApiService;
    const expiry = { recordRenewalWithin: () => Promise.resolve() } as unknown as ExpiryApiService;
    software = new SoftwareService(scratch.db, catalog, audit, expiry, config);
    const devices = {
      getByIds: (ids: string[]) =>
        Promise.resolve(
          new Map(ids.map((id) => [id, { id, code: `PC-E2E-GH-${deviceIds.indexOf(id)}` }])),
        ),
    } as unknown as DevicesApiService;
    seats = new LicenseAssignmentService(scratch.db, software, devices);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it(
    'kéo đúng ghế còn hiệu lực có ngày riêng trước hạn mới; ghi lịch sử từng ghế kèm mã máy',
    async () => {
      const id = await license();
      const result = await software.renew(ACTOR, id, '2027-12-31', (tx, oldEnd) =>
        seats.renewSeatsWithin(tx, ACTOR, id, oldEnd, '2027-12-31'),
      );
      expect(result.seatsRenewed).toBe(1);
      expect(await seatEnds(id)).toEqual(['2027-12-31', null, '2030-01-01', '2026-12-31']);

      const { rows } = await scratch.pool.query<{ changes: Record<string, unknown> }>(
        `SELECT changes FROM software_history
         WHERE software_id = $1 AND action = 'license-terms-updated'`,
        [id],
      );
      expect(rows.map((row) => row.changes)).toEqual([
        {
          device: { before: 'PC-E2E-GH-0', after: 'PC-E2E-GH-0' },
          endDate: { before: '2026-12-31', after: '2027-12-31' },
        },
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'ghế có kỳ hạn riêng NGẮN hơn hạn cũ của license (chủ ý, hoặc đã hết từ lâu) thì giữ nguyên',
    async () => {
      const id = await license();
      await scratch.pool.query(
        `UPDATE license_assignment SET end_date = '2026-03-31'
         WHERE software_id = $1 AND device_id = $2`,
        [id, deviceIds[1]],
      );
      const result = await software.renew(ACTOR, id, '2027-12-31', (tx, oldEnd) =>
        seats.renewSeatsWithin(tx, ACTOR, id, oldEnd, '2027-12-31'),
      );
      expect(result.seatsRenewed).toBe(1);
      expect(await seatEnds(id)).toEqual(['2027-12-31', '2026-03-31', '2030-01-01', '2026-12-31']);
    },
    TEST_TIMEOUT,
  );

  it(
    'không chọn cập nhật ghế thì ghế giữ nguyên',
    async () => {
      const id = await license();
      const result = await software.renew(ACTOR, id, '2027-12-31');
      expect(result.seatsRenewed).toBe(0);
      expect(await seatEnds(id)).toEqual(['2026-12-31', null, '2030-01-01', '2026-12-31']);
    },
    TEST_TIMEOUT,
  );

  it(
    'hạn mới không tiến lên → từ chối, ghế cũng không đổi',
    async () => {
      const id = await license();
      await expect(
        software.renew(ACTOR, id, '2026-06-30', (tx, oldEnd) =>
          seats.renewSeatsWithin(tx, ACTOR, id, oldEnd, '2026-06-30'),
        ),
      ).rejects.toMatchObject({ response: { code: 'RENEW_NOT_FORWARD' } });
      expect(await seatEnds(id)).toEqual(['2026-12-31', null, '2030-01-01', '2026-12-31']);
    },
    TEST_TIMEOUT,
  );
});
