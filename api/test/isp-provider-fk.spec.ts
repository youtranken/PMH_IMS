import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
 *   1. Migration 0074 đổi dữ liệu ĐÃ CÓ: chữ gõ tay phải khớp đúng mục danh mục, chữ lạ phải
 *      thành mục mới (không mất đường truyền nào), và bản sao tên phải bị khoá vào danh mục.
 *   2. Cửa ghi: id lạ / id ngừng dùng bị chặn, và danh mục không xoá được mục đang dùng.
 */

const TEST_TIMEOUT = 120_000;
const MIGRATION = '0074_isp_line_provider_fk.sql';
const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
const devices = { getByIds: () => Promise.resolve(new Map()) } as unknown as DevicesApiService;

describe('Migration 0074 — nối chữ nhà mạng cũ vào danh mục', () => {
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
    scratch = await createScratchDb('ims_isp_provider_mig');
    const before = await mkdtemp(join(tmpdir(), 'ims-mig-before-0074-'));
    const files = (await readdir(migrationsDir())).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files.filter((name) => name < MIGRATION)) {
      await writeFile(join(before, f), await readFile(join(migrationsDir(), f)));
    }
    await runMigrations(scratch.pool, before, { log: () => undefined });

    await scratch.pool.query(
      `INSERT INTO isp_provider (name, active) VALUES ('FPT Telecom', true), ('VNPT', false)`,
    );
    await scratch.pool.query(
      `INSERT INTO isp_line (code, provider) VALUES
         ('MIG-FPT-1', 'fpt telecom '),
         ('MIG-FPT-2', 'FPT   Telecom'),
         ('MIG-FPT-3', 'FPT Telecom'),
         ('MIG-VNPT', 'vnpt'),
         ('MIG-VT-1', 'Viettel'),
         ('MIG-VT-2', ' viettel'),
         ('MIG-CMC', 'CMC'),
         ('MIG-BLANK', '  ')`,
    );
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('chữ khớp danh mục (bỏ qua hoa-thường, khoảng trắng) nối vào đúng mục có sẵn', async () => {
    const fpt = await scratch.pool.query<{ id: string }>(
      `SELECT id FROM isp_provider WHERE name = 'FPT Telecom'`,
    );
    for (const code of ['MIG-FPT-1', 'MIG-FPT-2', 'MIG-FPT-3']) {
      expect(await line(code)).toEqual({
        provider: 'FPT Telecom',
        provider_id: fpt.rows[0].id,
        name: 'FPT Telecom',
      });
    }
    // Mục ngừng dùng vẫn là mục đúng — hồ sơ cũ không bị ép sang một mục đẻ thêm.
    expect((await line('MIG-VNPT')).name).toBe('VNPT');
  });

  it('chữ chưa có trong danh mục thành MỘT mục mới đang dùng cho mỗi tên', async () => {
    const { rows } = await scratch.pool.query<{ name: string; active: boolean }>(
      `SELECT name::text AS name, active FROM isp_provider ORDER BY lower(name::text) COLLATE "C"`,
    );
    expect(rows).toEqual([
      { name: 'Chưa rõ nhà mạng', active: true },
      { name: 'CMC', active: true },
      { name: 'FPT Telecom', active: true },
      { name: 'Viettel', active: true },
      { name: 'VNPT', active: false },
    ]);
    expect((await line('MIG-VT-1')).provider_id).toBe((await line('MIG-VT-2')).provider_id);
    expect((await line('MIG-BLANK')).name).toBe('Chưa rõ nhà mạng');
  });

  it('mỗi hàng đổi chữ có một dòng lịch sử; hàng giữ nguyên chữ thì không', async () => {
    const { rows } = await scratch.pool.query<{ code: string; changes: unknown }>(
      `SELECT l.code::text AS code, h.changes FROM isp_line_history h
         JOIN isp_line l ON l.id = h.isp_line_id
        WHERE h.actor = 'system:migration' ORDER BY l.code`,
    );
    expect(rows.map((r) => r.code)).toEqual([
      'MIG-BLANK',
      'MIG-FPT-1',
      'MIG-FPT-2',
      'MIG-VNPT',
      'MIG-VT-2',
    ]);
    expect(rows.find((r) => r.code === 'MIG-FPT-1')?.changes).toEqual({
      provider: { before: 'fpt telecom ', after: 'FPT Telecom' },
    });
  });

  it('provider_id bắt buộc và không có hàng nào lệch tên với danh mục', async () => {
    await expect(
      scratch.pool.query(`INSERT INTO isp_line (code, provider) VALUES ('MIG-NULL', 'CMC')`),
    ).rejects.toMatchObject({ code: '23502' });
    const { rows } = await scratch.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM isp_line l JOIN isp_provider p ON p.id = l.provider_id
        WHERE l.provider::text <> p.name::text`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('ghi một tên không khớp id → 23503: bản sao tên không trôi khỏi danh mục được', async () => {
    const cmc = await line('MIG-CMC');
    await expect(
      scratch.pool.query(
        `INSERT INTO isp_line (code, provider, provider_id) VALUES ('MIG-LECH', 'Tên khác', $1)`,
        [cmc.provider_id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('đổi tên trong danh mục → mọi đường truyền đổi theo, kể cả chỉ đổi hoa-thường', async () => {
    await scratch.pool.query(`UPDATE isp_provider SET name = 'CMC Telecom' WHERE name = 'CMC'`);
    expect((await line('MIG-CMC')).provider).toBe('CMC Telecom');
    const found = await scratch.pool.query<{ code: string }>(
      `SELECT code::text AS code FROM isp_line WHERE search_norm LIKE ims_norm('%cmc telecom%')`,
    );
    expect(found.rows.map((r) => r.code)).toEqual(['MIG-CMC']);

    await scratch.pool.query(`UPDATE isp_provider SET name = 'cmc telecom' WHERE name = 'CMC Telecom'`);
    expect((await line('MIG-CMC')).provider).toBe('cmc telecom');
  });

  it('xoá mục danh mục đang có đường truyền → 23503', async () => {
    await expect(
      scratch.pool.query(`DELETE FROM isp_provider WHERE name = 'Viettel'`),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('chỉ mục tìm kiếm được dựng lại và hợp lệ', async () => {
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
