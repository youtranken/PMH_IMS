import { runMigrations } from '../src/database/migration-runner';
import { ExpirySourceRegistry } from '../src/common/expiry/expiry-registry';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { ExpiryDigestService } from '../src/modules/expiry/expiry-digest.service';
import { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import { ExpiryService } from '../src/modules/expiry/expiry.service';
import { SoftwareExpiryRegistrar } from '../src/modules/software/software-expiry-sources';
import { SoftwareService } from '../src/modules/software/software.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Q-15 — gia hạn từ màn Sắp hết hạn (`POST /expiry/renew`) cũng ghi được số hợp đồng + chi phí
 * vào sổ gia hạn, cùng luật với nút Gia hạn trong hồ sơ phần mềm.
 *
 * Đi qua đường sản phẩm thật: `ExpiryService.renew` → nguồn hạn đã đăng ký → `SoftwareService.renew`
 * → `renewal_history`. Nguồn không có sổ gia hạn thì từ chối hai trường đó thay vì nuốt im.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'sa@pmh.com.vn';

describe('Q-15 · gia hạn từ màn Sắp hết hạn ghi hợp đồng + chi phí', () => {
  let scratch: ScratchDb;
  let expiry: ExpiryService;
  let registry: ExpirySourceRegistry;
  let round = 0;

  async function license(): Promise<string> {
    round += 1;
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO software (code, name, kind, license_model, seat_total, end_date, status)
       VALUES ($1, 'Office E2E', 'license', 'subscription', 5, '2026-12-31', 'active') RETURNING id`,
      [`LIC-E2E-EXP-${round}`],
    );
    return rows[0].id;
  }

  async function ledger(id: string) {
    const { rows } = await scratch.pool.query<{ contract: string | null; cost: string | null }>(
      `SELECT contract, cost::text AS cost FROM renewal_history WHERE object_id = $1 ORDER BY created_at`,
      [id],
    );
    return rows;
  }

  async function endOf(id: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ end: string }>(
      `SELECT to_char(end_date, 'YYYY-MM-DD') AS end FROM software WHERE id = $1`,
      [id],
    );
    return rows[0].end;
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_expiry_renew_terms');
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
    registry = new ExpirySourceRegistry();
    expiry = new ExpiryService(scratch.db, registry, audit, config);
    const software = new SoftwareService(
      scratch.db,
      catalog,
      audit,
      new ExpiryApiService(expiry, {} as ExpiryDigestService),
      config,
    );
    new SoftwareExpiryRegistrar(registry, software).onModuleInit();
    // Một nguồn KHÔNG có sổ gia hạn riêng: gia hạn được nhưng không nhận hợp đồng/chi phí.
    registry.register({
      sourceKind: 'e2e_plain',
      sourceLabel: 'Nguồn E2E không sổ',
      findExpiring: () => Promise.resolve([]),
      renew: () => Promise.resolve(),
    });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it(
    'ghi hợp đồng + chi phí vào sổ gia hạn qua đường /expiry/renew',
    async () => {
      const id = await license();
      await expiry.renew(ACTOR, 'license', id, '2027-12-31', {
        contract: '  HD-E2E-EXP  ',
        cost: 9_000_000,
      });
      expect(await ledger(id)).toEqual([{ contract: 'HD-E2E-EXP', cost: '9000000' }]);
      expect(await endOf(id)).toBe('2027-12-31');
    },
    TEST_TIMEOUT,
  );

  it(
    'bỏ trống hai trường thì sổ ghi null (gia hạn vẫn chạy như cũ)',
    async () => {
      const id = await license();
      await expiry.renew(ACTOR, 'license', id, '2027-12-31');
      expect(await ledger(id)).toEqual([{ contract: null, cost: null }]);
    },
    TEST_TIMEOUT,
  );

  it(
    'chi phí sai luật → từ chối như đường gia hạn phần mềm, hạn và sổ không đổi',
    async () => {
      const id = await license();
      await expect(
        expiry.renew(ACTOR, 'license', id, '2027-12-31', { cost: -1 }),
      ).rejects.toMatchObject({ response: { code: 'SOFTWARE_INVALID' } });
      expect(await ledger(id)).toEqual([]);
      expect(await endOf(id)).toBe('2026-12-31');
    },
    TEST_TIMEOUT,
  );

  it(
    'nguồn không có sổ gia hạn: từ chối hợp đồng/chi phí, không nuốt im',
    async () => {
      await expect(
        expiry.renew(ACTOR, 'e2e_plain', '00000000-0000-0000-0000-000000000000', '2027-12-31', {
          contract: 'HD-E2E-X',
        }),
      ).rejects.toMatchObject({ response: { code: 'EXPIRY_TERMS_UNSUPPORTED' } });
    },
    TEST_TIMEOUT,
  );

  it('danh sách nguồn nói rõ nguồn nào nhận hợp đồng/chi phí — web dựa vào đó để ẩn ô', () => {
    const kinds = expiry.kinds();
    expect(kinds.find((k) => k.kind === 'license')).toMatchObject({
      canRenew: true,
      canRenewTerms: true,
    });
    expect(kinds.find((k) => k.kind === 'e2e_plain')).toMatchObject({
      canRenew: true,
      canRenewTerms: false,
    });
  });
});
