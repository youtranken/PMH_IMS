import { runMigrations } from '../src/database/migration-runner';
import { IspLineService } from '../src/modules/software/isp-line.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import { createScratchDb, migrationsDir, seedIspProviders, type ScratchDb } from './db';

/**
 * Q-04 (`docs/QUYET-DINH.md`) — đường truyền không có ngày kết thúc.
 *
 * Cột `end_date` ở lại trong bảng (migration chỉ tiến) và dữ liệu cũ vẫn mang giá trị ở đó.
 * Chính dữ liệu cũ ấy là chỗ vỡ: ràng buộc `end_date >= start_date` còn sống thì người dùng
 * sửa ngày bắt đầu qua một cái hạn mà họ không còn nhìn thấy, và nhận lỗi 500 không lời giải.
 */

const TEST_TIMEOUT = 120_000;

describe('Q-04 · đường truyền không có hạn — tầng DB', () => {
  let scratch: ScratchDb;
  let isp: IspLineService;
  const actor = 'q04@test';
  let providers: Record<string, string>;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_isp_no_end');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const catalog = new CatalogApiService(new CatalogService(scratch.db, audit));
    providers = await seedIspProviders(scratch.pool, ['VNPT', 'FPT', 'Viettel']);
    const devices = { getByIds: () => Promise.resolve(new Map()) } as unknown as DevicesApiService;
    isp = new IspLineService(scratch.db, catalog, devices, audit);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('ràng buộc khoảng ngày và hai chỉ mục theo hạn đã gỡ', async () => {
    const constraints = await scratch.pool.query(
      `SELECT conname FROM pg_constraint WHERE conname = 'isp_line_range_check'`,
    );
    expect(constraints.rows).toEqual([]);
    const indexes = await scratch.pool.query(
      `SELECT indexname FROM pg_indexes
        WHERE indexname IN ('isp_line_end_idx', 'isp_line_end_code_idx')`,
    );
    expect(indexes.rows).toEqual([]);
  });

  it('dòng cũ còn hạn trong DB: dời ngày bắt đầu qua hạn đó vẫn lưu được', async () => {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO isp_line (code, provider, provider_id, start_date, end_date)
       VALUES ('Q04-CU-01', 'VNPT', $1, '2024-01-01', '2025-06-30') RETURNING id`,
      [providers.VNPT],
    );
    const updated = await isp.update(actor, rows[0].id, { startDate: '2026-01-01' });
    expect(updated.startDate).toBe('2026-01-01');
  });

  it('API không trả `endDate` ra ngoài, kể cả khi DB còn giá trị', async () => {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO isp_line (code, provider, provider_id, end_date)
       VALUES ('Q04-CU-02', 'FPT', $1, '2027-12-31') RETURNING id`,
      [providers.FPT],
    );
    const one = await isp.findOne(rows[0].id);
    expect(one).not.toHaveProperty('endDate');
    const created = await isp.create(actor, { code: 'Q04-MOI-01', providerId: providers.Viettel });
    expect(created).not.toHaveProperty('endDate');
  });

  it('thanh lý ghi người và thời điểm vào lịch sử', async () => {
    const line = await isp.create(actor, { code: 'Q04-TL-01', providerId: providers.FPT });
    await isp.update('nguoi-thanh-ly@test', line.id, { status: 'terminated' });

    const history = await isp.history(line.id);
    const liquidation = history.find(
      (row) => (row.changes as { status?: { after?: string } } | null)?.status?.after === 'terminated',
    );
    expect(liquidation?.actor).toBe('nguoi-thanh-ly@test');
    expect(liquidation?.createdAt).toBeInstanceOf(Date);
  });
});
