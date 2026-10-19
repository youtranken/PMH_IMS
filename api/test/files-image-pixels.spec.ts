import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { runMigrations } from '../src/database/migration-runner';
import type { OwnerExistsRegistry } from '../src/common/owner-exists.registry';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { FilesService } from '../src/modules/files/files.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Ảnh tải lên phải có trần số điểm ảnh, xét từ header lúc tải lên. Không có trần thì một PNG vài MB
 * nén toàn số 0 khai 50000×50000 lọt vào kho; lần đầu ai mở ảnh xem trước / bản vẽ là api giải mã
 * cả GB và bị OOM-kill. Bài hạ trần xuống 1 MP bằng SQL rồi dùng ảnh thật 2 MP, để khỏi dựng ảnh
 * khổng lồ trong test.
 */

const TEST_TIMEOUT = 120_000;

function png(width: number, height: number): Buffer {
  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="red"/></svg>`)
    .render()
    .asPng();
}

describe('ảnh tải lên có trần số điểm ảnh', () => {
  let scratch: ScratchDb;
  let files: FilesService;
  let storage: string;
  let uploader: string;
  const previousDir = process.env.FILE_STORAGE_DIR;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_files_pixels');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    storage = await mkdtemp(join(tmpdir(), 'ims-pixels-'));
    process.env.FILE_STORAGE_DIR = storage;
    await scratch.pool.query(
      `INSERT INTO system_config (key, value, description) VALUES ('file.max_image_megapixels', '1', 'test')
       ON CONFLICT (key) DO UPDATE SET value = '1'`,
    );
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash) VALUES ('e2e-pixels@qa.test', 'E2E pixels', 'member', 'x') RETURNING id`,
    );
    uploader = rows[0].id;
    const owners = {
      assertExists: () => Promise.resolve(),
      assertAccepts: () => Promise.resolve(),
    } as unknown as OwnerExistsRegistry;
    files = new FilesService(
      scratch.db,
      new AuditWriterService(scratch.db),
      owners,
      new UsersApiService(new UsersService(scratch.db)),
      new SystemConfigService(scratch.db),
      { register: () => undefined } as unknown as SweepService,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    process.env.FILE_STORAGE_DIR = previousDir;
    await rm(storage, { recursive: true, force: true });
    await scratch?.drop();
  }, TEST_TIMEOUT);

  const save = (buffer: Buffer) =>
    files.save({
      buffer,
      originalName: 'anh.png',
      ownerType: 'device',
      ownerId: '00000000-0000-4000-8000-000000000001',
      uploadedBy: uploader,
      actor: 'e2e-pixels@qa.test',
      actorRole: 'member',
    });

  it('ảnh vượt trần bị từ chối 400 ngay lúc tải lên, không có gì ghi ra đĩa hay DB', async () => {
    await expect(save(png(2000, 1000))).rejects.toMatchObject({ status: 400, response: { code: 'IMAGE_TOO_MANY_PIXELS' } });
    const { rows } = await scratch.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM file`);
    expect(rows[0].n).toBe(0);
  }, TEST_TIMEOUT);

  it('ảnh dưới trần lưu bình thường', async () => {
    await expect(save(png(1200, 300))).resolves.toMatchObject({ mimeType: 'image/png' });
  }, TEST_TIMEOUT);
});
