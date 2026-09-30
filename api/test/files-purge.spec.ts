import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migration-runner';
import type { OwnerExistsRegistry } from '../src/common/owner-exists.registry';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { FilesService } from '../src/modules/files/files.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Dọn blob của file đã xoá mềm (Q-18, `file.purge_after_days`).
 *
 * Xoá mềm giữ blob để lỡ tay còn lấy lại được; nhưng giữ mãi thì ổ đĩa chỉ lớn lên. Lượt dọn gỡ
 * NỘI DUNG khỏi đĩa, GIỮ hàng (lịch sử, nhật ký vẫn nói được ai đính kèm gì) và đánh dấu
 * `purged_at`. Bài này canh bốn điều: đúng ngưỡng cấu hình, hàng còn nguyên, chạy lại không làm
 * gì thêm, và blob đã mất sẵn không làm kẹt lượt dọn.
 */

const TEST_TIMEOUT = 120_000;
/** CỐ Ý khác mặc định 30 — bắt bản vá viết cứng số ngày. */
const KEEP_DAYS = 7;

describe('Dọn blob file đã xoá mềm', () => {
  let scratch: ScratchDb;
  let files: FilesService;
  let dir: string;
  let uploader: string;
  let keepDays = KEEP_DAYS;
  const registered: string[] = [];
  const previousDir = process.env.FILE_STORAGE_DIR;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_files_purge');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    dir = await mkdtemp(join(tmpdir(), 'ims-files-purge-'));
    process.env.FILE_STORAGE_DIR = dir;

    const config = {
      getNumber: (name: string) =>
        Promise.resolve(name === 'filePurgeAfterDays' ? keepDays : Number.NaN),
    } as unknown as SystemConfigService;
    const sweep = {
      register: (h: { name: string }) => registered.push(h.name),
    } as unknown as SweepService;

    files = new FilesService(
      scratch.db,
      new AuditWriterService(scratch.db),
      {} as OwnerExistsRegistry,
      new UsersApiService(new UsersService(scratch.db)),
      config,
      sweep,
    );
    files.onModuleInit();

    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash)
       VALUES ('purge@qa.test', 'Người tải', 'member', 'x') RETURNING id`,
    );
    uploader = rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    process.env.FILE_STORAGE_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    keepDays = KEEP_DAYS;
    // audit_log chỉ-thêm (trigger cấm DELETE): dòng nhật ký lọc theo id file của từng bài.
    await scratch.pool.query('DELETE FROM file');
  });

  /** Một hàng file + (tuỳ chọn) blob trên đĩa. `deletedDaysAgo = null` = file còn sống. */
  async function seed(
    name: string,
    deletedDaysAgo: number | null,
    opts: { blob?: boolean; purgedDaysAgo?: number } = {},
  ): Promise<{ id: string; stored: string }> {
    const stored = randomUUID();
    if (opts.blob !== false) await writeFile(join(dir, stored), `%PDF ${name}`);
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO file (original_name, stored_name, mime_type, size_bytes, owner_type, owner_id,
                         uploaded_by, deleted_at, purged_at)
       VALUES ($1, $2, 'application/pdf', 10, 'device', $3, $4,
               CASE WHEN $5::int IS NULL THEN NULL ELSE now() - make_interval(days => $5::int) END,
               CASE WHEN $6::int IS NULL THEN NULL ELSE now() - make_interval(days => $6::int) END)
       RETURNING id`,
      [name, stored, randomUUID(), uploader, deletedDaysAgo, opts.purgedDaysAgo ?? null],
    );
    return { id: rows[0].id, stored };
  }

  async function purgedAt(id: string): Promise<Date | null> {
    const { rows } = await scratch.pool.query<{ purged_at: Date | null }>(
      'SELECT purged_at FROM file WHERE id = $1',
      [id],
    );
    expect(rows).toHaveLength(1); // hàng KHÔNG bao giờ bị xoá
    return rows[0].purged_at;
  }

  const purgeAudits = async (ids: string[]) =>
    (
      await scratch.pool.query<{ actor: string; detail: { count: number; fileIds: string[] } }>(
        `SELECT actor, detail FROM audit_log
          WHERE action = 'file.purged' AND detail->'fileIds' ?| $1::text[]`,
        [ids],
      )
    ).rows;

  it('đăng ký vào sweep của worker', () => {
    expect(registered).toContain('file-purge');
  });

  it('gỡ blob file xoá quá ngưỡng, giữ hàng, đánh dấu purged_at, một dòng nhật ký cho cả lượt', async () => {
    const old = await seed('cu.pdf', KEEP_DAYS + 3);
    const recent = await seed('moi-xoa.pdf', KEEP_DAYS - 2);
    const alive = await seed('con-dung.pdf', null);

    expect(await files.purgeDeleted()).toBe(1);

    expect(existsSync(join(dir, old.stored))).toBe(false);
    expect(await purgedAt(old.id)).not.toBeNull();
    expect(existsSync(join(dir, recent.stored))).toBe(true);
    expect(await purgedAt(recent.id)).toBeNull();
    expect(existsSync(join(dir, alive.stored))).toBe(true);
    expect(await purgedAt(alive.id)).toBeNull();

    const audits = await purgeAudits([old.id, recent.id, alive.id]);
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toBe('system');
    expect(audits[0].detail.count).toBe(1);
    expect(audits[0].detail.fileIds).toEqual([old.id]);
  });

  it('chạy lại không làm gì thêm, không đẻ thêm dòng nhật ký', async () => {
    const old = await seed('cu.pdf', KEEP_DAYS + 3);
    expect(await files.purgeDeleted()).toBe(1);
    expect(await files.purgeDeleted()).toBe(0);
    expect(await purgeAudits([old.id])).toHaveLength(1);
  });

  it('blob đã mất sẵn trên đĩa vẫn được đánh dấu, không làm kẹt lượt dọn', async () => {
    const missing = await seed('mat-blob.pdf', KEEP_DAYS + 1, { blob: false });
    const present = await seed('con-blob.pdf', KEEP_DAYS + 1);
    expect(await files.purgeDeleted()).toBe(2);
    expect(await purgedAt(missing.id)).not.toBeNull();
    expect(existsSync(join(dir, present.stored))).toBe(false);
  });

  it('hàng đã dọn từ trước giữ nguyên mốc purged_at cũ', async () => {
    const done = await seed('da-don.pdf', 100, { blob: false, purgedDaysAgo: 50 });
    const before = await purgedAt(done.id);
    expect(await files.purgeDeleted()).toBe(0);
    expect(await purgedAt(done.id)).toEqual(before);
  });

  it('ngưỡng cấu hình hỏng (<1) thì không dọn gì — dọn nhầm không lấy lại được', async () => {
    keepDays = 0;
    const old = await seed('cu.pdf', 365);
    expect(await files.purgeDeleted()).toBe(0);
    expect(existsSync(join(dir, old.stored))).toBe(true);
  });
});
