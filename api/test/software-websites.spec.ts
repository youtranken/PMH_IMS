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
 * SW-043 · Q-15 — "website nào dùng chứng chỉ SSL nào, theo từng năm".
 *
 * Hồ sơ SSL / tên miền giữ danh sách website HIỆN TẠI (tìm được từ ô tìm của danh sách), và mỗi
 * lượt gia hạn chụp lại danh sách của kỳ đó vào sổ gia hạn — sửa danh sách năm nay không được
 * làm đổi câu trả lời cho "năm ngoái cert này phủ những website nào".
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'sa@pmh.com.vn';
const PAGE = { page: 1, limit: 50 };

describe('SW-043 · website dùng chứng chỉ SSL / tên miền, theo từng kỳ gia hạn', () => {
  let scratch: ScratchDb;
  let software: SoftwareService;
  let round = 0;

  async function ssl(websites: string[]): Promise<string> {
    round += 1;
    const created = await software.create(ACTOR, {
      code: `SSL-E2E-WEB-${round}`,
      name: 'Chứng chỉ E2E',
      kind: 'ssl',
      endDate: '2026-12-31',
      websites,
    });
    return created.id;
  }

  async function ledger(id: string) {
    const { rows } = await scratch.pool.query<{ websites: string[] | null; new_end: string }>(
      `SELECT websites, to_char(new_end, 'YYYY-MM-DD') AS new_end
       FROM renewal_history WHERE object_id = $1 ORDER BY created_at`,
      [id],
    );
    return rows;
  }

  async function current(id: string): Promise<string[]> {
    const { rows } = await scratch.pool.query<{ websites: string[] }>(
      `SELECT websites FROM software WHERE id = $1`,
      [id],
    );
    return rows[0].websites;
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_sw_websites');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
      getNumber: () => Promise.resolve(30),
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
    'hồ sơ SSL lưu danh sách website đã chuẩn hoá; hồ sơ khác mặc định rỗng',
    async () => {
      const id = await ssl([' https://Shop.E2E.vn/ ', '', 'mail.e2e.vn', 'SHOP.e2e.vn']);
      expect(await current(id)).toEqual(['shop.e2e.vn', 'mail.e2e.vn']);
      const { rows } = await scratch.pool.query<{ websites: string[] }>(
        `INSERT INTO software (code, name, kind, end_date) VALUES ('LIC-E2E-WEB', 'x', 'license', '2027-01-01')
         RETURNING websites`,
      );
      expect(rows[0].websites).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    'ô tìm của danh sách phần mềm tìm ra hồ sơ theo website',
    async () => {
      const id = await ssl(['portal-tim.e2e.vn']);
      const page = await software.list(PAGE, { search: 'portal-tim' });
      expect(page.items.map((item) => item.id)).toEqual([id]);
    },
    TEST_TIMEOUT,
  );

  it(
    'sửa danh sách website ghi vào lịch sử hồ sơ',
    async () => {
      const id = await ssl(['a.e2e.vn']);
      await software.update(ACTOR, id, { websites: ['a.e2e.vn', 'b.e2e.vn'] });
      expect(await current(id)).toEqual(['a.e2e.vn', 'b.e2e.vn']);
      const { rows } = await scratch.pool.query<{ changes: Record<string, unknown> }>(
        `SELECT changes FROM software_history WHERE software_id = $1 AND action = 'updated'`,
        [id],
      );
      expect(rows[0].changes).toEqual({
        websites: { before: 'a.e2e.vn', after: 'a.e2e.vn, b.e2e.vn' },
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'mỗi lượt gia hạn chụp danh sách của kỳ đó; đổi danh sách lúc gia hạn không đổi kỳ trước',
    async () => {
      const id = await ssl(['a.e2e.vn', 'b.e2e.vn']);
      // Không gửi danh sách → sổ chụp danh sách đang có của hồ sơ.
      await software.renew(ACTOR, id, '2027-12-31');
      // Năm sau bỏ b, thêm c ngay trong hộp gia hạn.
      await software.renew(ACTOR, id, '2028-12-31', undefined, {
        websites: ['a.e2e.vn', 'C.e2e.vn'],
      });
      expect(await ledger(id)).toEqual([
        { websites: ['a.e2e.vn', 'b.e2e.vn'], new_end: '2027-12-31' },
        { websites: ['a.e2e.vn', 'c.e2e.vn'], new_end: '2028-12-31' },
      ]);
      expect(await current(id)).toEqual(['a.e2e.vn', 'c.e2e.vn']);

      const { rows } = await scratch.pool.query<{ changes: Record<string, unknown> }>(
        `SELECT changes FROM software_history WHERE software_id = $1 AND action = 'renewed'
         ORDER BY created_at`,
        [id],
      );
      expect(rows[1].changes).toMatchObject({
        websites: { before: 'a.e2e.vn, b.e2e.vn', after: 'a.e2e.vn, c.e2e.vn' },
      });

      const renewals = await software.renewals(id);
      expect(renewals.map((row) => row.websites)).toEqual([
        ['a.e2e.vn', 'c.e2e.vn'],
        ['a.e2e.vn', 'b.e2e.vn'],
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'license không có khái niệm website: sổ gia hạn để null',
    async () => {
      const { rows } = await scratch.pool.query<{ id: string }>(
        `INSERT INTO software (code, name, kind, license_model, seat_total, end_date)
         VALUES ('LIC-E2E-WEB-2', 'Office', 'license', 'subscription', 5, '2026-12-31') RETURNING id`,
      );
      await software.renew(ACTOR, rows[0].id, '2027-12-31');
      expect(await ledger(rows[0].id)).toEqual([{ websites: null, new_end: '2027-12-31' }]);
    },
    TEST_TIMEOUT,
  );

  it(
    'website dán hai cái một dòng → từ chối, hồ sơ và sổ không đổi',
    async () => {
      const id = await ssl(['a.e2e.vn']);
      await expect(
        software.update(ACTOR, id, { websites: ['a.e2e.vn b.e2e.vn'] }),
      ).rejects.toMatchObject({ response: { code: 'SOFTWARE_INVALID' } });
      await expect(
        software.renew(ACTOR, id, '2027-12-31', undefined, { websites: ['x y'] }),
      ).rejects.toMatchObject({ response: { code: 'SOFTWARE_INVALID' } });
      expect(await current(id)).toEqual(['a.e2e.vn']);
      expect(await ledger(id)).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});
