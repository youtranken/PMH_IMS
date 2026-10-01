import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Migration 0037 (Q-20) dựng chỉ mục duy nhất "một máy một IP đang cấp". DB đích mà đã có máy
 * giữ hai IP thì phải DỪNG với câu nêu mã máy và các IP cần thu hồi bớt, không chết bằng một
 * lỗi "could not create unique index" trơ trọi chỉ có uuid.
 */

const TEST_TIMEOUT = 120_000;
const TARGET = '0037_ip_one_per_device.sql';

describe('0037 · máy đang giữ hai IP thì dừng, nói rõ máy nào', () => {
  let scratch: ScratchDb;
  let before: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_ip_one_per_device_migration');
    before = await mkdtemp(join(tmpdir(), 'ims-0037-'));
    for (const file of await readdir(migrationsDir())) {
      if (file.endsWith('.sql') && file < TARGET) {
        await copyFile(join(migrationsDir(), file), join(before, file));
      }
    }
    await runMigrations(scratch.pool, before, { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
    if (before) await rm(before, { recursive: true, force: true });
  }, TEST_TIMEOUT);

  it(
    'PC-E2E-0037 giữ 10.37.0.5 và 10.37.0.6 → migration ném, nêu mã máy và cả hai IP',
    async () => {
      const type = await scratch.pool.query<{ id: string }>(
        `INSERT INTO device_type (name) VALUES ('May E2E 0037') RETURNING id`,
      );
      const dev = await scratch.pool.query<{ id: string }>(
        `INSERT INTO device (code, name, device_type_id) VALUES ('PC-E2E-0037', 'x', $1) RETURNING id`,
        [type.rows[0].id],
      );
      const subnet = await scratch.pool.query<{ id: string }>(
        `INSERT INTO subnet (name, cidr, created_by) VALUES ('LAN E2E 0037', '10.37.0.0/24', 'e2e')
         RETURNING id`,
      );
      await scratch.pool.query(
        `INSERT INTO ip_address (subnet_id, address, device_id, assigned_by, status)
         VALUES ($1, '10.37.0.5', $2, 'e2e', 'assigned'), ($1, '10.37.0.6', $2, 'e2e', 'assigned')`,
        [subnet.rows[0].id, dev.rows[0].id],
      );
      await copyFile(join(migrationsDir(), TARGET), join(before, TARGET));
      await expect(runMigrations(scratch.pool, before, { log: () => undefined })).rejects.toThrow(
        /0037.*PC-E2E-0037.*10\.37\.0\.5.*10\.37\.0\.6/s,
      );

      // Thu hồi bớt IP thừa xong thì chạy lại được.
      await scratch.pool.query(
        `UPDATE ip_address SET status = 'free', device_id = NULL WHERE address = '10.37.0.6'`,
      );
      await runMigrations(scratch.pool, before, { log: () => undefined });
    },
    TEST_TIMEOUT,
  );
});
