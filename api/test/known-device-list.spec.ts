import { runMigrations } from '../src/database/migration-runner';
import { KnownDeviceService } from '../src/modules/auth/known-device.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * X-04: SA xem "thiết bị đã biết" của một tài khoản (bảng chỉ dùng để quyết định có báo thư "đăng
 * nhập từ máy mới" không). Chỉ đọc — không lộ dấu vân tay máy (`device_hash`).
 */
const TEST_TIMEOUT = 120_000;
const noopSweep = { register: () => undefined } as unknown as SweepService;

describe('KnownDeviceService.listForUser', () => {
  let scratch: ScratchDb;
  let devices: KnownDeviceService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_known_device_list');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    devices = new KnownDeviceService(scratch.db, new SystemConfigService(scratch.db), noopSweep);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it(
    'máy mới thấy gần nhất đứng đầu; chỉ nhãn + mốc, không trả device_hash; người khác không lẫn',
    async () => {
      const ids: string[] = [];
      for (const email of ['kd-a@qa.test', 'kd-b@qa.test']) {
        const { rows } = await scratch.pool.query<{ id: string }>(
          `INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, 'KD', 'member', 'x') RETURNING id`,
          [email],
        );
        ids.push(rows[0].id);
      }
      await scratch.pool.query(
        `INSERT INTO known_device (user_id, device_hash, label, first_seen_at, last_seen_at) VALUES
           ($1, 'h1', 'Chrome · Windows', now() - interval '10 days', now() - interval '2 days'),
           ($1, 'h2', 'Safari · iPhone', now() - interval '1 day', now()),
           ($2, 'h3', 'Firefox · Linux', now(), now())`,
        ids,
      );
      const list = await devices.listForUser(ids[0]);
      expect(list.map((row) => row.label)).toEqual(['Safari · iPhone', 'Chrome · Windows']);
      expect(Object.keys(list[0]).sort()).toEqual(['firstSeenAt', 'id', 'label', 'lastSeenAt']);
    },
    TEST_TIMEOUT,
  );
});
