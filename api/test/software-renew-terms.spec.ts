import { runMigrations } from '../src/database/migration-runner';
import { ExpirySourceRegistry } from '../src/common/expiry/expiry-registry';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { ExpiryDigestService } from '../src/modules/expiry/expiry-digest.service';
import { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import { ExpiryService } from '../src/modules/expiry/expiry.service';
import { SoftwareService } from '../src/modules/software/software.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * SW-049 · Q-15 — số hợp đồng và chi phí của MỖI lần gia hạn nằm ở sổ `renewal_history`, không
 * phải cột của hồ sơ phần mềm: gia hạn năm sau không được đè lên hợp đồng năm trước.
 *
 * Đi qua đường sản phẩm thật: `SoftwareService.renew` → `ExpiryApiService.recordRenewalWithin`
 * → bảng chỉ-thêm thật, cùng một transaction.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'sa@pmh.com.vn';

describe('SW-049 · gia hạn ghi số hợp đồng + chi phí vào sổ gia hạn', () => {
  let scratch: ScratchDb;
  let software: SoftwareService;
  let round = 0;

  async function license(): Promise<string> {
    round += 1;
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO software (code, name, kind, license_model, seat_total, end_date, status)
       VALUES ($1, 'Office E2E', 'license', 'subscription', 5, '2026-12-31', 'active') RETURNING id`,
      [`LIC-E2E-HD-${round}`],
    );
    return rows[0].id;
  }

  async function ledger(id: string) {
    const { rows } = await scratch.pool.query<{
      contract: string | null;
      cost: string | null;
      new_end: string;
    }>(
      `SELECT contract, cost::text AS cost, to_char(new_end, 'YYYY-MM-DD') AS new_end
       FROM renewal_history WHERE object_id = $1 ORDER BY created_at`,
      [id],
    );
    return rows;
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_sw_renew_terms');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    } as unknown as SystemConfigService;
    const catalog = {
      lists: () => Promise.resolve({ vendors: [] }),
      validateRefs: () => Promise.resolve([]),
      assertRefs: () => Promise.resolve(),
    } as unknown as CatalogApiService;
    const expiry = new ExpiryApiService(
      new ExpiryService(scratch.db, new ExpirySourceRegistry(), audit, config),
      {} as ExpiryDigestService,
    );
    software = new SoftwareService(scratch.db, catalog, audit, expiry, config);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it(
    'ghi hợp đồng + chi phí của lượt gia hạn vào sổ, và sổ đọc lại được qua hồ sơ',
    async () => {
      const id = await license();
      await software.renew(ACTOR, id, '2027-12-31', undefined, {
        contract: '  HD-E2E-2027  ',
        cost: 12_500_000,
      });
      expect(await ledger(id)).toEqual([
        { contract: 'HD-E2E-2027', cost: '12500000', new_end: '2027-12-31' },
      ]);

      const renewals = await software.renewals(id);
      expect(renewals).toMatchObject([
        { contract: 'HD-E2E-2027', cost: 12_500_000, oldEnd: '2026-12-31', newEnd: '2027-12-31' },
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'mỗi lượt gia hạn giữ hợp đồng của riêng nó — lượt sau không đè lượt trước',
    async () => {
      const id = await license();
      await software.renew(ACTOR, id, '2027-12-31', undefined, { contract: 'HD-E2E-A', cost: 1_000 });
      await software.renew(ACTOR, id, '2028-12-31', undefined, { contract: 'HD-E2E-B', cost: 0 });
      expect(await ledger(id)).toEqual([
        { contract: 'HD-E2E-A', cost: '1000', new_end: '2027-12-31' },
        // 0 ₫ là giá trị THẬT (gia hạn tặng kèm), không phải "chưa khai".
        { contract: 'HD-E2E-B', cost: '0', new_end: '2028-12-31' },
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'bỏ trống hai ô thì sổ ghi null, không phải chuỗi rỗng hay 0',
    async () => {
      const id = await license();
      await software.renew(ACTOR, id, '2027-12-31');
      await software.renew(ACTOR, id, '2028-12-31', undefined, { contract: '   ', cost: null });
      expect(await ledger(id)).toEqual([
        { contract: null, cost: null, new_end: '2027-12-31' },
        { contract: null, cost: null, new_end: '2028-12-31' },
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'lịch sử hồ sơ của lượt gia hạn nêu kèm hợp đồng + chi phí',
    async () => {
      const id = await license();
      await software.renew(ACTOR, id, '2027-12-31', undefined, { contract: 'HD-E2E-LS', cost: 500 });
      const { rows } = await scratch.pool.query<{ changes: Record<string, unknown> }>(
        `SELECT changes FROM software_history WHERE software_id = $1 AND action = 'renewed'`,
        [id],
      );
      expect(rows[0].changes).toEqual({
        endDate: { before: '2026-12-31', after: '2027-12-31' },
        contract: { before: 'HD-E2E-LS', after: 'HD-E2E-LS' },
        cost: { before: 500, after: 500 },
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'chi phí âm / vượt số nguyên an toàn → từ chối, hạn và sổ không đổi',
    async () => {
      const id = await license();
      for (const cost of [-1, Number.MAX_SAFE_INTEGER + 2, 1.5]) {
        await expect(
          software.renew(ACTOR, id, '2027-12-31', undefined, { contract: 'HD-E2E-X', cost }),
        ).rejects.toMatchObject({ response: { code: 'SOFTWARE_INVALID' } });
      }
      expect(await ledger(id)).toEqual([]);
      const { rows } = await scratch.pool.query<{ end_date: string }>(
        `SELECT to_char(end_date, 'YYYY-MM-DD') AS end_date FROM software WHERE id = $1`,
        [id],
      );
      expect(rows[0].end_date).toBe('2026-12-31');
    },
    TEST_TIMEOUT,
  );

  it(
    'sổ vẫn chỉ-thêm sau khi có hai cột mới: sửa hợp đồng của lượt cũ bị chặn',
    async () => {
      const id = await license();
      await software.renew(ACTOR, id, '2027-12-31', undefined, { contract: 'HD-E2E-KHOA' });
      await expect(
        scratch.pool.query(`UPDATE renewal_history SET contract = 'sua' WHERE object_id = $1`, [id]),
      ).rejects.toThrow();
    },
    TEST_TIMEOUT,
  );
});
