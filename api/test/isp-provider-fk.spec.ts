import { BadRequestException, ConflictException } from '@nestjs/common';
import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { IspLineService } from '../src/modules/software/isp-line.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * OLD-DB-01 (QUYET-DINH Q-11) — nhà mạng của đường truyền là khoá ngoại tới danh mục.
 *
 * Hai nửa hỏng theo hai kiểu:
 *   1. Lược đồ: bản sao tên `isp_line.provider` bị khoá vào danh mục bằng khoá ngoại kép, nên
 *      không trôi được, đổi tên thì đi theo, và danh mục không xoá được mục đang dùng.
 *   2. Cửa ghi: id lạ / id ngừng dùng bị chặn, và danh mục trả lỗi đọc được.
 */

const TEST_TIMEOUT = 120_000;
const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
const devices = { getByIds: () => Promise.resolve(new Map()) } as unknown as DevicesApiService;

describe('Lược đồ — nhà mạng của đường truyền là khoá ngoại kép (id, tên)', () => {
  let scratch: ScratchDb;

  const line = async (code: string) =>
    (
      await scratch.pool.query<{ provider: string; provider_id: string; name: string }>(
        `SELECT l.provider::text AS provider, l.provider_id, p.name::text AS name
           FROM isp_line l JOIN isp_provider p ON p.id = l.provider_id WHERE l.code = $1`,
        [code],
      )
    ).rows[0];

  beforeAll(async () => {
    scratch = await createScratchDb('ims_isp_provider_schema');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    await scratch.pool.query(
      `INSERT INTO isp_provider (name) VALUES ('CMC'), ('Viettel');
       INSERT INTO isp_line (code, provider, provider_id)
         SELECT 'SCH-' || upper(name::text), name, id FROM isp_provider`,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('provider_id bắt buộc', async () => {
    await expect(
      scratch.pool.query(`INSERT INTO isp_line (code, provider) VALUES ('SCH-NULL', 'CMC')`),
    ).rejects.toMatchObject({ code: '23502' });
  });

  it('ghi một tên không khớp id → 23503: bản sao tên không trôi khỏi danh mục được', async () => {
    const cmc = await line('SCH-CMC');
    await expect(
      scratch.pool.query(
        `INSERT INTO isp_line (code, provider, provider_id) VALUES ('SCH-LECH', 'Tên khác', $1)`,
        [cmc.provider_id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('đổi tên trong danh mục → mọi đường truyền đổi theo, kể cả chỉ đổi hoa-thường', async () => {
    await scratch.pool.query(`UPDATE isp_provider SET name = 'CMC Telecom' WHERE name = 'CMC'`);
    expect((await line('SCH-CMC')).provider).toBe('CMC Telecom');
    const found = await scratch.pool.query<{ code: string }>(
      `SELECT code::text AS code FROM isp_line WHERE search_norm LIKE ims_norm('%cmc telecom%')`,
    );
    expect(found.rows.map((r) => r.code)).toEqual(['SCH-CMC']);

    await scratch.pool.query(`UPDATE isp_provider SET name = 'cmc telecom' WHERE name = 'CMC Telecom'`);
    expect((await line('SCH-CMC')).provider).toBe('cmc telecom');
  });

  it('xoá mục danh mục đang có đường truyền → 23503', async () => {
    await expect(
      scratch.pool.query(`DELETE FROM isp_provider WHERE name = 'Viettel'`),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('chỉ mục tìm kiếm hợp lệ', async () => {
    const { rows } = await scratch.pool.query<{ valid: boolean }>(
      `SELECT i.indisvalid AS valid FROM pg_index i
        WHERE i.indexrelid = 'isp_line_search_norm_trgm'::regclass`,
    );
    expect(rows).toEqual([{ valid: true }]);
  });
});

describe('Cửa ghi đường truyền và danh mục — nhà mạng là khoá ngoại', () => {
  let scratch: ScratchDb;
  let isp: IspLineService;
  let catalog: CatalogService;
  const actor = 'old-db-01@test';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    scratch = await createScratchDb('ims_isp_provider_ref');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    catalog = new CatalogService(scratch.db, audit);
    isp = new IspLineService(scratch.db, new CatalogApiService(catalog), devices, audit);
    const { rows } = await scratch.pool.query<{ id: string; name: string }>(
      `INSERT INTO isp_provider (name, active) VALUES ('FPT', true), ('VNPT', true), ('Cũ', false)
       RETURNING id, name::text AS name`,
    );
    for (const row of rows) ids[row.name] = row.id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('tạo: trả cả id lẫn tên nhà mạng', async () => {
    const created = await isp.create(actor, { code: 'REF-01', providerId: ids.FPT });
    expect(created).toMatchObject({ providerId: ids.FPT, provider: 'FPT' });
    expect(await isp.findOne(created.id)).toMatchObject({ providerId: ids.FPT, provider: 'FPT' });
  });

  it('tạo thiếu nhà mạng → 400', async () => {
    await expect(isp.create(actor, { code: 'REF-THIEU' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('id nhà mạng không có trong danh mục → 400, không ghi gì', async () => {
    await expect(
      isp.create(actor, { code: 'REF-LA', providerId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const { rows } = await scratch.pool.query(`SELECT 1 FROM isp_line WHERE code = 'REF-LA'`);
    expect(rows).toEqual([]);
  });

  it('chọn nhà mạng ngừng dùng cho đường MỚI hoặc khi ĐỔI → 400', async () => {
    await expect(
      isp.create(actor, { code: 'REF-CU', providerId: ids['Cũ'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const line = await isp.create(actor, { code: 'REF-DOI', providerId: ids.FPT });
    await expect(
      isp.update(actor, line.id, { providerId: ids['Cũ'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nhà mạng đã ngừng dùng nhưng KHÔNG đổi → vẫn sửa được các ô khác', async () => {
    const line = await isp.create(actor, { code: 'REF-GIU', providerId: ids.VNPT });
    await catalog.setActive(actor, 'isp_provider', ids.VNPT, false);
    const updated = await isp.update(actor, line.id, {
      providerId: ids.VNPT,
      hotline: '1800 1091',
    });
    expect(updated).toMatchObject({ providerId: ids.VNPT, provider: 'VNPT', hotline: '1800 1091' });
    await catalog.setActive(actor, 'isp_provider', ids.VNPT, true);
  });

  it('đổi nhà mạng ghi lịch sử bằng TÊN, không phải uuid', async () => {
    const line = await isp.create(actor, { code: 'REF-LS', providerId: ids.FPT });
    await isp.update(actor, line.id, { providerId: ids.VNPT });
    const history = await isp.history(line.id);
    expect(history[0].changes).toMatchObject({ provider: { before: 'FPT', after: 'VNPT' } });
  });

  it('lọc theo id nhà mạng', async () => {
    const page = await isp.list({ page: 1, limit: 50 }, { providerId: ids.VNPT });
    expect(page.items.every((item) => item.providerId === ids.VNPT)).toBe(true);
    expect(page.items.map((item) => item.code)).toContain('REF-GIU');
  });

  it('đổi tên ở danh mục → hồ sơ đường truyền đọc ra tên mới', async () => {
    await catalog.update(actor, 'isp_provider', ids.FPT, { name: 'FPT Telecom' });
    const page = await isp.list({ page: 1, limit: 50 }, { search: 'fpt telecom' });
    expect(page.items.map((item) => item.code)).toContain('REF-01');
    expect(page.items.every((item) => item.provider === 'FPT Telecom')).toBe(true);
  });

  it('danh mục xoá nhà mạng đang có đường truyền → 409 CATALOG_IN_USE', async () => {
    const error = await catalog.remove(actor, 'isp_provider', ids.FPT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'CATALOG_IN_USE' });
  });

  it('danh mục xoá nhà mạng không ai dùng → xoá được', async () => {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO isp_provider (name) VALUES ('Rảnh') RETURNING id`,
    );
    await catalog.remove(actor, 'isp_provider', rows[0].id);
    const left = await scratch.pool.query(`SELECT 1 FROM isp_provider WHERE id = $1`, [rows[0].id]);
    expect(left.rows).toEqual([]);
  });
});
