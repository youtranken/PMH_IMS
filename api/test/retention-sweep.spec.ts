import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../src/database/migration-runner';
import type { Database } from '../src/database/database.module';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import { SessionService } from '../src/modules/auth/session.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * HAI BẢNG CHỈ LỚN LÊN, KHÔNG AI DỌN (D-02 + "outbox không có retention").
 *
 * ===== ĐO LẠI TRƯỚC KHI VÁ, VÀ CON SỐ KHÁC SỔ =====
 *
 * Sổ rà soát 19/09 ghi "54.904 phiên chết" và "54.536 hàng outbox". Đo lại trên chính DB dev
 * ngày 21/09:
 *
 *     outbox                69.583 hàng — 100% đã xử lý, 0 hàng cũ hơn 30 ngày
 *     sessions              67.394 hàng — nhưng chỉ 1 hàng `last_seen_at` quá 30 ngày
 *     security.probe.alert  109 hàng, mỗi hàng mang một địa chỉ email
 *
 * Con số "đã chết" nhỏ hơn hẳn vì lượt gieo 200k hồ sơ (mục 13-15) đẻ ra toàn hàng MỚI. Nói
 * ra chứ không chép lại số cũ: một bản vá được biện hộ bằng con số không còn đúng là một bản
 * vá sẽ bị nghi ngờ đúng lúc nó cần được tin.
 *
 * Nhưng lỗ thì vẫn nguyên, và nó là lỗ CẤU TRÚC chứ không phải một con số:
 *
 *   · `SessionService.purgeOld()` ĐÃ TỒN TẠI từ lâu, có cả chú thích "Gọi từ sweep (worker)"
 *     — và KHÔNG AI GỌI. Một hàm dọn không ai gọi trông y hệt một hàm dọn đang chạy.
 *   · `outbox` không có đường dọn nào cả.
 *
 * ===== VÌ SAO 109 HÀNG EMAIL LÀ CHUYỆN THẬT =====
 *
 * `security.probe.alert` mang `who: <email>` trong payload. Đó là NGOẠI LỆ CÓ TÊN, khai sẵn
 * cạnh chính luật "payload không PII" (AD-11/NFR-04) — nên không phải vi phạm, và tôi không
 * đi "sửa" nó.
 *
 * Nhưng ngoại lệ ấy được cấp cho việc ĐI ĐƯỜNG: để email tới được consumer mail. Giữ nó lại
 * VĨNH VIỄN sau khi đã gửi xong chưa bao giờ nằm trong phần được cấp — và mỗi bản `pg_dump`
 * đêm chở theo danh sách những người từng bị nghi dò két.
 *
 * Retention là chỗ đúng để đóng chuyện đó: không đụng tới ngoại lệ, chỉ thôi giữ mãi.
 */

const TEST_TIMEOUT = 120_000;

/** Ngưỡng bài kiểm dùng — CỐ Ý khác giá trị mặc định, để bắt bản vá viết cứng số 30. */
const KEEP_DAYS = 7;

describe('Dọn định kỳ — phiên chết và outbox đã xử lý', () => {
  let scratch: ScratchDb;
  let outbox: OutboxService;
  let sessions: SessionService;
  const registered: string[] = [];

  beforeAll(async () => {
    scratch = await createScratchDb('ims_retention');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = drizzle(scratch.pool) as unknown as Database;

    const config = {
      getNumber: () => Promise.resolve(KEEP_DAYS),
    } as unknown as SystemConfigService;
    const sweep = {
      register: (h: { name: string }) => registered.push(h.name),
    } as unknown as SweepService;

    outbox = new OutboxService(db, config, sweep);
    sessions = new SessionService(db, config, sweep);
    outbox.onModuleInit();
    sessions.onModuleInit();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await scratch.pool.query('DELETE FROM outbox');
    await scratch.pool.query('DELETE FROM sessions');
    await scratch.pool.query('DELETE FROM users');
  });

  /** Một hàng outbox với `processed_at` đặt lùi về quá khứ. */
  async function seedOutbox(topic: string, processedDaysAgo: number | null): Promise<void> {
    await scratch.pool.query(
      `INSERT INTO outbox (topic, payload, processed_at)
       VALUES ($1, '{"who":"ai-do@pmh.com.vn"}'::jsonb,
               CASE WHEN $2::int IS NULL THEN NULL ELSE now() - ($2 || ' days')::interval END)`,
      [topic, processedDaysAgo],
    );
  }

  async function seedSession(lastSeenDaysAgo: number): Promise<void> {
    const user = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash)
       VALUES ($1, 'Nguoi kiem', 'member', 'x') RETURNING id`,
      [`phien-${lastSeenDaysAgo}-${Date.now()}@pmh.com.vn`],
    );
    await scratch.pool.query(
      `INSERT INTO sessions (user_id, csrf_token, absolute_expires_at, last_seen_at)
       VALUES ($1, $2, now() + interval '1 day', now() - ($3 || ' days')::interval)`,
      [user.rows[0].id, `csrf-${Math.random()}`, lastSeenDaysAgo],
    );
  }

  const countOf = async (table: string): Promise<number> => {
    const { rows } = await scratch.pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
    return Number(rows[0].n);
  };

  describe('đăng ký vào sweep — vế bị bỏ quên suốt từ đầu', () => {
    it('cả hai lượt dọn PHẢI có mặt trong sweep', () => {
      // `purgeOld()` có từ lâu, chú thích ghi hẳn "Gọi từ sweep (worker)", và không ai gọi.
      // Một hàm dọn không ai gọi trông y hệt một hàm dọn đang chạy.
      expect(registered).toContain('session-purge');
      expect(registered).toContain('outbox-purge');
    });
  });

  describe('outbox', () => {
    it(
      'hàng ĐÃ XỬ LÝ quá hạn giữ thì bị xoá; hàng mới thì ở lại',
      async () => {
        await seedOutbox('auth.device.new', KEEP_DAYS + 1);
        await seedOutbox('auth.device.new', 1);
        expect(await outbox.purgeProcessed()).toBe(1);
        expect(await countOf('outbox')).toBe(1);
      },
      TEST_TIMEOUT,
    );

    it(
      'hàng CHƯA XỬ LÝ không bao giờ bị xoá, dù cũ tới đâu',
      async () => {
        // Đây là vế quan trọng nhất của cả bài. `processed_at IS NULL` nghĩa là việc CHƯA
        // xong — relay còn phải đẩy lại, và SA còn thấy nó ở `listFailed`. Dọn nhầm một hàng
        // như thế là đánh mất một lá thư mà không ai biết, vĩnh viễn.
        await seedOutbox('auth.device.new', null);
        expect(await outbox.purgeProcessed()).toBe(0);
        expect(await countOf('outbox')).toBe(1);
      },
      TEST_TIMEOUT,
    );

    it(
      'ngưỡng đọc từ `system_config`, không viết cứng 30 (AD-11)',
      async () => {
        // Bài dùng ngưỡng 7. Một bản vá viết cứng 30 sẽ giữ lại hàng 10 ngày tuổi và ca này đỏ.
        await seedOutbox('auth.device.new', 10);
        expect(await outbox.purgeProcessed()).toBe(1);
      },
      TEST_TIMEOUT,
    );
  });

  describe('phiên đăng nhập', () => {
    it(
      'phiên chết quá hạn giữ thì bị xoá; phiên còn dùng thì ở lại',
      async () => {
        await seedSession(KEEP_DAYS + 1);
        await seedSession(1);
        expect(await sessions.purgeOld()).toBe(1);
        expect(await countOf('sessions')).toBe(1);
      },
      TEST_TIMEOUT,
    );

    it(
      'ngưỡng cũng đọc từ `system_config`',
      async () => {
        await seedSession(10);
        expect(await sessions.purgeOld()).toBe(1);
      },
      TEST_TIMEOUT,
    );
  });
});
