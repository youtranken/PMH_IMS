import { randomUUID } from 'node:crypto';
import { runMigrations } from '../src/database/migration-runner';
import type { OwnerExistsRegistry } from '../src/common/owner-exists.registry';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { FilesService } from '../src/modules/files/files.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Tab Giấy tờ nói AI tải file lên (DEV-082): họ tên tra qua `users.api` (AD-2) theo một mẻ,
 * không JOIN bảng `users` từ module files.
 */

const TEST_TIMEOUT = 120_000;

describe('Giấy tờ · người tải lên', () => {
  let scratch: ScratchDb;
  let files: FilesService;
  const ownerId = randomUUID();

  beforeAll(async () => {
    scratch = await createScratchDb('ims_files_uploader');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    files = new FilesService(
      scratch.db,
      {} as AuditWriterService,
      {} as OwnerExistsRegistry,
      new UsersApiService(new UsersService(scratch.db)),
      {} as SystemConfigService,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function user(email: string, fullName: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, 'member', 'x') RETURNING id`,
      [email, fullName],
    );
    return rows[0].id;
  }

  async function file(name: string, uploadedBy: string): Promise<void> {
    await scratch.pool.query(
      `INSERT INTO file (original_name, stored_name, mime_type, size_bytes, owner_type, owner_id, uploaded_by)
       VALUES ($1, $2, 'application/pdf', 10, 'device', $3, $4)`,
      [name, randomUUID(), ownerId, uploadedBy],
    );
  }

  it('mỗi file mang họ tên đúng người tải', async () => {
    const an = await user('an.uploader@qa.test', 'Nguyễn Văn An');
    const binh = await user('binh.uploader@qa.test', 'Trần Thị Bình');
    await file('hoa-don.pdf', an);
    await file('bien-ban.pdf', binh);
    await file('bao-hanh.pdf', an);

    const list = await files.listFor('device', ownerId);
    const byName = Object.fromEntries(list.map((row) => [row.originalName, row.uploadedByName]));
    expect(byName).toEqual({
      'hoa-don.pdf': 'Nguyễn Văn An',
      'bien-ban.pdf': 'Trần Thị Bình',
      'bao-hanh.pdf': 'Nguyễn Văn An',
    });
  });
});
