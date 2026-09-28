import { Pool } from 'pg';
import { runMigrations } from '../src/database/migration-runner';
import type { Database } from '../src/database/database.module';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import type { ExcelImportService } from '../src/common/excel/excel-import.service';
import type { ExcelExportService } from '../src/common/excel/excel-export.service';
import type { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import type { OwnerExistsRegistry } from '../src/common/owner-exists.registry';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DeviceImportService } from '../src/modules/devices/device-import.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import { IpAddressService } from '../src/modules/ipam/ip-address.service';
import type { SubnetService } from '../src/modules/ipam/subnet.service';
import { SoftwareService } from '../src/modules/software/software.service';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import { ServiceAccountService } from '../src/modules/service-accounts/service-account.service';
import { VaultService } from '../src/modules/vault/vault.service';
import { createScratchDb, migrationsDir, testDbUrl, waitForLock, type ScratchDb } from './db';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';

/**
 * LOST UPDATE (BE-02) và KÉT GHI VÀO SECRET ĐÃ THU HỒI (BE-03).
 *
 * Mọi đường ghi ở đây đều đi theo cùng một hình: đọc hàng NGOÀI transaction, quyết định trên
 * ảnh chụp đó, rồi `UPDATE ... WHERE id = $1` vô điều kiện. Một lượt ghi khác commit vào giữa
 * thì bị ghi đè mà không bên nào gặp lỗi.
 *
 * Mỗi bài dàn cảnh tất định, không đua: kết nối `holder` mở transaction, làm đúng việc của
 * lượt chen ngang (thanh lý, thu hồi, gia hạn…) nhưng CHƯA commit. Lượt đang kiểm chạy tiếp;
 * `waitForLock` chứng minh nó thật sự đứng chờ khóa hàng, rồi `holder` mới commit. Lượt đang
 * kiểm vì thế luôn đọc ảnh chụp CŨ và ghi SAU — đúng khe hở của lỗi.
 *
 * Không mock drizzle: câu hỏi là hành vi khóa của Postgres, thứ mà không đồ giả nào có.
 * Các phụ thuộc ngoài module (audit, catalog, config…) là đồ giả tối thiểu vì chúng không
 * nằm trên đường khóa.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.sua@pmh.com.vn';
/** Mốc cũ cho `updated_at` của hàng gieo sẵn — lượt chen ngang chắc chắn ghi ra mốc khác. */
const OLD = `now() - interval '1 hour'`;

type Outcome = { error: null } | { error: { status?: number; code?: string; message: string } };

function describeError(error: unknown): { status?: number; code?: string; message: string } {
  const e = error as {
    getStatus?: () => number;
    getResponse?: () => unknown;
    message?: string;
  };
  const response = e.getResponse?.() as { code?: string } | undefined;
  return { status: e.getStatus?.(), code: response?.code, message: e.message ?? String(error) };
}

describe('Hai lượt ghi cùng lúc không được đè nhau (BE-02, BE-03)', () => {
  let scratch: ScratchDb;
  let holder: Pool;
  let db: Database;
  let deviceTypeId: string;

  const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
  const config = {
    getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
  } as unknown as SystemConfigService;
  const catalog = {
    validateRefs: () => Promise.resolve([]),
    assertRefs: () => Promise.resolve(),
    lists: () =>
      Promise.resolve({ deviceTypes: [], sites: [], cabinets: [], vendors: [] }),
    snapshot: () =>
      Promise.resolve({
        sites: new Map(),
        cabinets: new Map(),
        deviceTypes: new Map([['may dua', { id: deviceTypeId, name: 'May dua' }]]),
        vendors: new Map(),
      }),
  } as unknown as CatalogApiService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_lost_update');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    holder = new Pool({ connectionString: testDbUrl(scratch.name), max: 1 });
    holder.on('error', () => undefined);
    db = scratch.db;
    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('May dua') RETURNING id`,
    );
    deviceTypeId = type.rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await holder?.end();
    await scratch?.drop();
  }, TEST_TIMEOUT);

  /**
   * Chạy `statements` trong một transaction CHƯA commit, cho `action` chạy tới lúc đứng chờ
   * khóa, rồi mới commit. Không có ai chờ khóa thì `waitForLock` ném — đó cũng là một câu
   * trả lời: đường ghi đã không hề chạm tới hàng đang bị giữ.
   */
  async function interleave(
    statements: [string, unknown[]][],
    action: () => Promise<unknown>,
  ): Promise<Outcome> {
    const client = await holder.connect();
    try {
      await client.query('BEGIN');
      for (const [text, params] of statements) await client.query(text, params);
      const running = action().then(
        (): Outcome => ({ error: null }),
        (error: unknown): Outcome => ({ error: describeError(error) }),
      );
      await waitForLock(scratch.pool);
      await client.query('COMMIT');
      return await running;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Mã/địa chỉ riêng cho mỗi bài — bảng lịch sử là chỉ-thêm nên không dọn hàng cũ được. */
  let seq = 10;
  const nextSeq = () => ++seq;

  async function one<T>(text: string, params: unknown[]): Promise<T> {
    const { rows } = await scratch.pool.query(text, params);
    return rows[0] as T;
  }

  // ─────────────────────────── Thiết bị ───────────────────────────

  describe('Thiết bị', () => {
    let devices: DevicesService;
    let deviceImport: DeviceImportService;
    let importSheet: Record<string, { rowNumber: number; cells: Record<string, string> }[]>;
    let deviceId: string;
    let deviceCode: string;

    beforeAll(() => {
      const noRetirement = {
        holdingsWithin: () => Promise.resolve([]),
        releaseAllWithin: () => Promise.resolve(),
      } as unknown as DeviceRetirementRegistry;
      devices = new DevicesService(db, catalog, audit, noRetirement, new DeviceSearchRegistry());
      const excelIn = { read: () => Promise.resolve(importSheet) } as unknown as ExcelImportService;
      deviceImport = new DeviceImportService(
        db,
        excelIn,
        {} as ExcelExportService,
        devices,
        catalog,
        audit,
      );
    });

    beforeEach(async () => {
      deviceCode = `PC-RACE-${nextSeq()}`;
      const row = await one<{ id: string }>(
        `INSERT INTO device (code, name, device_type_id, status, updated_at)
         VALUES ($1, 'May cu', $2, 'in_use', ${OLD}) RETURNING id`,
        [deviceCode, deviceTypeId],
      );
      deviceId = row.id;
    });

    const retire: () => [string, unknown[]][] = () => [
      [
        `UPDATE device SET status = 'retired', updated_at = clock_timestamp() WHERE id = $1`,
        [deviceId],
      ],
    ];

    it(
      'sửa hồ sơ đua với thanh lý: 409, máy vẫn "đã thanh lý" — không sống lại in_use',
      async () => {
        const outcome = await interleave(retire(), () =>
          devices.update(ACTOR, deviceId, { name: 'Ten moi', status: 'in_use' }),
        );

        expect(outcome.error).toMatchObject({ status: 409, code: 'DEVICE_ALREADY_CHANGED' });
        const row = await one<{ status: string; name: string }>(
          'SELECT status, name FROM device WHERE id = $1',
          [deviceId],
        );
        expect(row).toEqual({ status: 'retired', name: 'May cu' });
      },
      TEST_TIMEOUT,
    );

    it(
      'import sửa hồ sơ đua với thanh lý: từ chối cả file, hồ sơ đã thanh lý không bị sửa',
      async () => {
        importSheet = {
          'Thiết bị': [
            {
              rowNumber: 2,
              cells: {
                'Mã thiết bị *': deviceCode,
                'Tên thiết bị *': 'Ten tu file',
                'Loại *': 'May dua',
              },
            },
          ],
        };
        const outcome = await interleave(retire(), () =>
          deviceImport.commit(ACTOR, Buffer.from('')),
        );

        expect(outcome.error).toMatchObject({ code: 'DEVICE_RETIRED' });
        const row = await one<{ status: string; name: string }>(
          'SELECT status, name FROM device WHERE id = $1',
          [deviceId],
        );
        expect(row).toEqual({ status: 'retired', name: 'May cu' });
      },
      TEST_TIMEOUT,
    );

    it('không ai chen ngang: sửa hồ sơ vừa INSERT (updated_at micro-giây) vẫn ghi được', async () => {
      const fresh = await one<{ id: string }>(
        `INSERT INTO device (code, name, device_type_id) VALUES ($1, 'May moi', $2)
         RETURNING id`,
        [`PC-RACE-${nextSeq()}`, deviceTypeId],
      );
      const result = await devices.update(ACTOR, fresh.id, { name: 'Da doi ten' });
      expect(result.device.name).toBe('Da doi ten');
    });
  });

  // ─────────────────────────── IP ───────────────────────────

  describe('Hồ sơ IP', () => {
    let addresses: IpAddressService;
    let ipId: string;
    let subnetId: string;

    beforeAll(() => {
      const devicesApi = {
        assertUsableWithin: () => Promise.resolve(),
        getByIds: () => Promise.resolve(new Map()),
      } as unknown as DevicesApiService;
      const subnets = {
        cidrOf: () => Promise.resolve('10.9.0.0/24'),
      } as unknown as SubnetService;
      addresses = new IpAddressService(db, audit, devicesApi, subnets, config);
    });

    beforeAll(async () => {
      const subnet = await one<{ id: string }>(
        `INSERT INTO subnet (name, cidr, created_by) VALUES ('Dai dua', '10.9.0.0/24', $1)
         RETURNING id`,
        [ACTOR],
      );
      subnetId = subnet.id;
    });

    beforeEach(async () => {
      const ip = await one<{ id: string }>(
        `INSERT INTO ip_address (subnet_id, address, status, used_by, assigned_by, updated_at)
         VALUES ($1, $2, 'assigned', 'Chu cu', $3, ${OLD}) RETURNING id`,
        [subnetId, `10.9.0.${nextSeq()}`, ACTOR],
      );
      ipId = ip.id;
    });

    it(
      'sửa người dùng đua với thu hồi: 409, không để lại hàng lai "trống mà có chủ"',
      async () => {
        const outcome = await interleave(
          [
            [
              `UPDATE ip_address SET status = 'free', device_id = NULL, used_by = NULL,
                      updated_at = clock_timestamp() WHERE id = $1`,
              [ipId],
            ],
          ],
          () => addresses.update(ACTOR, ipId, { usedBy: 'Phong Ke toan' }),
        );

        expect(outcome.error).toMatchObject({ status: 409, code: 'IP_ALREADY_CHANGED' });
        const row = await one<{ status: string; used_by: string | null }>(
          'SELECT status, used_by FROM ip_address WHERE id = $1',
          [ipId],
        );
        expect(row).toEqual({ status: 'free', used_by: null });
      },
      TEST_TIMEOUT,
    );
  });

  // ─────────────────────────── Phần mềm ───────────────────────────

  describe('Phần mềm', () => {
    let software: SoftwareService;
    let renewals: { oldEnd: string | null; newEnd: string }[];
    let softwareId: string;

    beforeAll(() => {
      const expiry = {
        recordRenewalWithin: (_tx: unknown, entry: { oldEnd: string | null; newEnd: string }) => {
          renewals.push(entry);
          return Promise.resolve();
        },
      } as unknown as ExpiryApiService;
      software = new SoftwareService(db, catalog, audit, expiry, config);
    });

    beforeEach(() => {
      renewals = [];
    });

    async function seed(endDate: string, status: string): Promise<void> {
      const row = await one<{ id: string }>(
        `INSERT INTO software (code, name, kind, license_model, end_date, status, updated_at)
         VALUES ($1, 'Chung chi dua', 'ssl', 'subscription', $2, $3, ${OLD})
         RETURNING id`,
        [`SSL-RACE-${nextSeq()}`, endDate, status],
      );
      softwareId = row.id;
    }

    it(
      'hai lượt gia hạn cùng lúc: lượt sau 409, hạn KHÔNG lùi, sổ gia hạn không ghi oldEnd sai',
      async () => {
        await seed('2027-01-01', 'active');
        const outcome = await interleave(
          [
            [
              `UPDATE software SET end_date = '2028-01-01', updated_at = clock_timestamp()
                WHERE id = $1`,
              [softwareId],
            ],
          ],
          () => software.renew(ACTOR, softwareId, '2027-06-01'),
        );

        expect(outcome.error).toMatchObject({ status: 409, code: 'SOFTWARE_ALREADY_CHANGED' });
        const row = await one<{ end_date: string }>(
          'SELECT end_date::text FROM software WHERE id = $1',
          [softwareId],
        );
        expect(row.end_date).toBe('2028-01-01');
        expect(renewals).toEqual([]);
      },
      TEST_TIMEOUT,
    );

    it(
      'sửa hạn đua với thanh lý: 409, hồ sơ vẫn "thanh lý" — không bị tính lại thành "đang dùng"',
      async () => {
        await seed('2025-01-01', 'expired_ok');
        const outcome = await interleave(
          [
            [
              `UPDATE software SET status = 'retired', updated_at = clock_timestamp()
                WHERE id = $1`,
              [softwareId],
            ],
          ],
          () => software.update(ACTOR, softwareId, { endDate: '2030-01-01' }),
        );

        expect(outcome.error).toMatchObject({ status: 409, code: 'SOFTWARE_ALREADY_CHANGED' });
        const row = await one<{ status: string; end_date: string }>(
          'SELECT status, end_date::text FROM software WHERE id = $1',
          [softwareId],
        );
        expect(row).toEqual({ status: 'retired', end_date: '2025-01-01' });
      },
      TEST_TIMEOUT,
    );

    it('không ai chen ngang: gia hạn vẫn chạy và ghi đúng oldEnd', async () => {
      await seed('2027-01-01', 'active');
      await software.renew(ACTOR, softwareId, '2028-01-01');
      expect(renewals).toEqual([
        expect.objectContaining({ oldEnd: '2027-01-01', newEnd: '2028-01-01' }),
      ]);
    });
  });

  // ─────────────────────────── Tài khoản dịch vụ ───────────────────────────

  describe('Tài khoản dịch vụ', () => {
    let accounts: ServiceAccountService;
    let accountId: string;
    let accountCode: string;

    beforeAll(() => {
      accounts = new ServiceAccountService(db, audit);
    });

    beforeEach(async () => {
      accountCode = `SA-RACE-${nextSeq()}`;
      const row = await one<{ id: string }>(
        `INSERT INTO service_account (code, kind, name, login, status, created_by, updated_at)
         VALUES ($1, 'shared', 'Hop thu chung', 'ketoan@pmh.com.vn', 'active', $2, ${OLD})
         RETURNING id`,
        [accountCode, ACTOR],
      );
      accountId = row.id;
    });

    const disable = (): [string, unknown[]][] => [
      [
        `UPDATE service_account SET status = 'disabled', updated_at = clock_timestamp()
          WHERE id = $1`,
        [accountId],
      ],
      [
        `INSERT INTO service_account_history (service_account_id, action, actor, changes)
         VALUES ($1, 'disabled', 'nguoi.khoa@pmh.com.vn', '{}'::jsonb)`,
        [accountId],
      ],
    ];

    it(
      'sửa hồ sơ đua với vô hiệu hóa: 409, tài khoản vẫn bị khóa — không được mở lại',
      async () => {
        const outcome = await interleave(disable(), () =>
          accounts.update(ACTOR, accountId, {
            kind: 'shared',
            code: accountCode,
            name: 'Ten moi',
            login: 'ketoan@pmh.com.vn',
          }),
        );

        expect(outcome.error).toMatchObject({
          status: 409,
          code: 'SERVICE_ACCOUNT_ALREADY_CHANGED',
        });
        const row = await one<{ status: string; name: string }>(
          'SELECT status, name FROM service_account WHERE id = $1',
          [accountId],
        );
        expect(row).toEqual({ status: 'disabled', name: 'Hop thu chung' });
      },
      TEST_TIMEOUT,
    );

    it(
      'hai lượt vô hiệu hóa cùng lúc: lượt sau báo "đã vô hiệu từ trước", lịch sử chỉ MỘT dòng',
      async () => {
        const outcome = await interleave(disable(), () =>
          accounts.disable(ACTOR, accountId, 'Nhan vien nghi viec'),
        );

        expect(outcome.error).toMatchObject({ code: 'STATUS_UNCHANGED' });
        const history = await one<{ n: number }>(
          `SELECT count(*)::int AS n FROM service_account_history
            WHERE service_account_id = $1 AND action = 'disabled'`,
          [accountId],
        );
        expect(history.n).toBe(1);
      },
      TEST_TIMEOUT,
    );

    it('không ai chen ngang: sửa hồ sơ giữ nguyên trạng thái và ghi được', async () => {
      const result = await accounts.update(ACTOR, accountId, {
        kind: 'shared',
        code: accountCode,
        name: 'Ten moi',
        login: 'ketoan@pmh.com.vn',
      });
      expect(result).toMatchObject({ name: 'Ten moi', status: 'active' });
    });
  });

  // ─────────────────────────── Két ───────────────────────────

  describe('Két — secret vừa bị thu hồi (BE-03)', () => {
    let vault: VaultService;
    let secretId: string;

    beforeAll(() => {
      const crypto = {
        seal: () => ({
          ciphertext: Buffer.from('moi'),
          iv: Buffer.alloc(12, 1),
          tag: Buffer.alloc(16, 1),
          wrappedDek: Buffer.alloc(60, 1),
          keyVersion: 2,
        }),
      } as unknown as EnvelopeCryptoService;
      const owners = {
        assertUsableWithin: () => Promise.resolve(),
      } as unknown as OwnerExistsRegistry;
      vault = new VaultService(db, crypto, audit, owners);
    });

    beforeEach(async () => {
      const row = await one<{ id: string }>(
        `INSERT INTO secret (owner_type, owner_id, kind, label, value_ct, value_iv, value_tag,
                             dek_wrapped, key_version, created_by)
         VALUES ('device', gen_random_uuid(), 'password', 'admin web', '\\x00', '\\x00', '\\x00',
                 '\\x00', 1, $1)
         RETURNING id`,
        [ACTOR],
      );
      secretId = row.id;
    });

    const revokeBy = (who: string): [string, unknown[]][] => [
      [
        `UPDATE secret SET revoked_at = clock_timestamp(), revoked_by = $2 WHERE id = $1`,
        [secretId, who],
      ],
    ];

    async function secretRow() {
      return one<{ key_version: number; note: string | null; revoked_by: string | null }>(
        'SELECT key_version, note, revoked_by FROM secret WHERE id = $1',
        [secretId],
      );
    }

    it(
      'xoay mật khẩu đua với thu hồi: 404, không ghi giá trị mới vào secret đã thu hồi',
      async () => {
        const outcome = await interleave(revokeBy('nguoi.thu.hoi@pmh.com.vn'), () =>
          vault.rotate(ACTOR, secretId, 'MatKhauMoi!'),
        );

        expect(outcome.error).toMatchObject({ status: 404, code: 'SECRET_NOT_FOUND' });
        expect(await secretRow()).toMatchObject({ key_version: 1 });
      },
      TEST_TIMEOUT,
    );

    it(
      'sửa nhãn/ghi chú đua với thu hồi: 404, secret đã thu hồi giữ nguyên',
      async () => {
        const outcome = await interleave(revokeBy('nguoi.thu.hoi@pmh.com.vn'), () =>
          vault.updateMeta(ACTOR, secretId, { note: 'ghi chu moi' }),
        );

        expect(outcome.error).toMatchObject({ status: 404, code: 'SECRET_NOT_FOUND' });
        expect(await secretRow()).toMatchObject({ note: null });
      },
      TEST_TIMEOUT,
    );

    it(
      'hai lượt thu hồi cùng lúc: lượt sau 404, "ai thu hồi" vẫn là người thu hồi trước',
      async () => {
        const outcome = await interleave(revokeBy('nguoi.truoc@pmh.com.vn'), () =>
          vault.revoke('nguoi.sau@pmh.com.vn', secretId),
        );

        expect(outcome.error).toMatchObject({ status: 404, code: 'SECRET_NOT_FOUND' });
        expect(await secretRow()).toMatchObject({ revoked_by: 'nguoi.truoc@pmh.com.vn' });
      },
      TEST_TIMEOUT,
    );
  });
});
