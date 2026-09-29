import { Pool } from 'pg';
import { runMigrations } from '../src/database/migration-runner';
import { LoginFailureService } from '../src/modules/auth/login-failure.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';
import type { Database } from '../src/database/database.module';

/**
 * KHOÁ ĐĂNG NHẬP THEO CẶP (NGƯỜI DÙNG, IP) — NFR-01 bản 11/09.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * Bộ đếm gõ sai nằm trên hàng `users`, nên cái khoá đặt lên TÀI KHOẢN. Ai biết email của một
 * người là khoá được họ ra ngoài: năm request, lặp lại tuỳ thích. Trần theo IP
 * (`login.rate_limit_per_ip`, 60 giây) không cứu — khoá chỉ cần 5 lượt, nên một IP khoá được
 * khoảng 4 tài khoản mỗi phút.
 *
 * Người đáng khoá nhất là SA, đúng lúc đang có sự cố cần đăng nhập để xử lý.
 *
 * ===== VÌ SAO Ở TẦNG NÀY =====
 *
 * Vế quyết định — "gõ sai từ chỗ A KHÔNG được chặn chỗ B" — cần hai IP khác nhau. E2E không
 * dựng được: Playwright chạy trên một máy, mà nginx ghi `X-Forwarded-For` bằng
 * `$proxy_add_x_forwarded_for` (NỐI THÊM địa chỉ socket thật) và Express đặt `trust proxy = 1`,
 * nên client KHÔNG tự khai IP của mình được. Đó là hàng rào đúng, và nó khiến E2E mù đúng chỗ
 * này.
 *
 * Nên bài chạy `LoginFailureService` THẬT trên một DB THẬT, chỉ thay hai thứ không liên quan
 * tới điều đang kiểm: `SystemConfigService` (trả một con số) và `SweepService` (sổ đăng ký).
 * Drizzle, migration và Postgres đều là đồ thật — CLAUDE.md cấm mock drizzle, và ở đây không
 * cần mock nó.
 *
 * Vế còn lại — `login()` có THẬT SỰ đọc bộ đếm này không — do
 * `e2e/tests/login-lockout-per-ip.spec.ts` giữ.
 */

const TEST_TIMEOUT = 120_000;
const POLICY = { maxFailedAttempts: 5, lockoutMinutes: 15 };
const IP_A = '203.0.113.10';
const IP_B = '198.51.100.20';

function fakeConfig(lockoutMinutes: number): SystemConfigService {
  return { getNumber: () => Promise.resolve(lockoutMinutes) } as unknown as SystemConfigService;
}

const noopSweep = { register: () => undefined } as unknown as SweepService;

describe('Khoá đăng nhập đặt lên CẶP (người dùng, IP)', () => {
  let scratch: ScratchDb;
  let pool: Pool;
  let db: Database;
  let service: LoginFailureService;
  let userId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_login_lock');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    pool = scratch.pool;
    db = scratch.db;
    service = new LoginFailureService(db, fakeConfig(POLICY.lockoutMinutes), noopSweep);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await pool.query('DELETE FROM login_failure');
    await pool.query('DELETE FROM users');
    const row = await pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash)
       VALUES ('khoa-theo-noi@pmh.com.vn', 'Nguoi dung kiem khoa', 'sa', 'x') RETURNING id`,
    );
    userId = row.rows[0].id;
  });

  /** Gõ sai `times` lượt từ một nơi, mỗi lượt một transaction như đường thật. */
  async function failFrom(ip: string, times: number, now = new Date()) {
    let last = { failedAttempts: 0, lockedUntil: null as Date | null, justLocked: false };
    for (let i = 0; i < times; i += 1) {
      last = await db.transaction((tx) =>
        service.registerFailureWithin(tx, userId, ip, POLICY, now),
      );
    }
    return last;
  }

  it(
    'ĐÂY LÀ CẢ BÀI: gõ sai đủ ngưỡng từ nơi A không được chạm tới nơi B',
    async () => {
      const atA = await failFrom(IP_A, POLICY.maxFailedAttempts);
      // Nơi đang gõ sai phải bị khoá.
      expect(atA.lockedUntil).not.toBeNull();

      /*
       * Câu chốt. Bản trước bộ đếm nằm trên hàng `users`, nên tới đây NGƯỜI DÙNG THẬT — đang
       * ngồi ở bàn của họ, chưa gõ sai lần nào — cũng không vào được. Đó là cái nút mà người
       * lạ bấm được.
       */
      const atB = await service.stateFor(userId, IP_B);
      // Nơi khác chưa gõ sai lần nào, nên phải KHÔNG bị khoá.
      expect(atB.failedAttempts).toBe(0);
      expect(atB.lockedUntil).toBeNull();
    },
    TEST_TIMEOUT,
  );

  it(
    'VẾ ĐỐI CHỨNG: đủ ngưỡng thì nơi đang gõ PHẢI bị khoá thật, không chỉ đếm suông',
    async () => {
      const before = await failFrom(IP_A, POLICY.maxFailedAttempts - 1);
      // Chưa đủ ngưỡng thì chưa khoá.
      expect(before.lockedUntil).toBeNull();

      const after = await failFrom(IP_A, 1);
      expect(after.lockedUntil).not.toBeNull();
      // Lượt vừa chạm ngưỡng phải báo `justLocked` đúng một lần.
      expect(after.justLocked).toBe(true);

      // Và lượt tiếp theo KHÔNG được báo `justLocked` nữa — nếu không, SA nhận một thư mỗi lượt gõ.
      const more = await failFrom(IP_A, 1);
      expect(more.justLocked).toBe(false);
    },
    TEST_TIMEOUT,
  );

  it(
    'đăng nhập được từ nơi B chỉ xoá dấu vết của B — khoá ở A còn nguyên',
    async () => {
      await failFrom(IP_A, POLICY.maxFailedAttempts);
      await failFrom(IP_B, 2);

      await service.clearFor(userId, IP_B);

      expect((await service.stateFor(userId, IP_B)).failedAttempts).toBe(0);
      /*
       * Người dùng thật vào được KHÔNG phải bằng chứng rằng kẻ đang dò ở chỗ khác đã thôi gõ.
       * Xoá sạch mọi nơi ở đây là tự tay mở khoá cho họ.
       */
      // Khoá ở nơi khác phải sống sót.
      expect((await service.stateFor(userId, IP_A)).lockedUntil).not.toBeNull();
    },
    TEST_TIMEOUT,
  );

  it(
    'hai lượt sai ĐỒNG THỜI cùng một cặp phải đếm đủ hai, không đè nhau',
    async () => {
      /*
       * Cùng lớp lỗi đã vá trên hàng `users` hôm 08/09 (#5: N lượt đoán song song chỉ tốn 1
       * lượt đếm). Bảng mới phải không tái lập nó — và ở đây có thêm một khe riêng: hàng CHƯA
       * TỒN TẠI lúc hai lượt cùng vào, nên `FOR UPDATE` không có gì để khoá.
       */
      const now = new Date();
      const [a, b] = await Promise.all([
        db.transaction((tx) => service.registerFailureWithin(tx, userId, IP_A, POLICY, now)),
        db.transaction((tx) => service.registerFailureWithin(tx, userId, IP_A, POLICY, now)),
      ]);

      const counted = Math.max(a.failedAttempts, b.failedAttempts);
      // Hai lượt song song phải tính đủ hai.
      expect(counted).toBe(2);
      const rows = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM login_failure WHERE user_id = $1',
        [userId],
      );
      // Và chỉ được đẻ ra MỘT hàng cho một cặp.
      expect(rows.rows[0].n).toBe(1);
    },
    TEST_TIMEOUT,
  );

  describe('Dọn hàng nguội', () => {
    it(
      'xoá hàng đã nguội — không dọn thì bảng này là chỗ ai cũng ghi thêm mà không ai xoá',
      async () => {
        await failFrom(IP_A, 1);
        await pool.query(
          `UPDATE login_failure SET updated_at = now() - interval '30 days', locked_until = NULL`,
        );

        await service.pruneStale();

        const left = await pool.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM login_failure',
        );
        expect(left.rows[0].n).toBe(0);
      },
      TEST_TIMEOUT,
    );

    it(
      'VẾ ĐỐI CHỨNG QUAN TRỌNG NHẤT: hàng ĐANG KHOÁ không bao giờ bị dọn',
      async () => {
        await failFrom(IP_A, POLICY.maxFailedAttempts);
        /*
         * Hàng vừa cũ VỪA đang khoá. Dọn nhầm nó là tự tay mở khoá cho người đang dò — một
         * sweeper "dọn cho sạch" viết vội sẽ làm đúng chuyện đó, và không ai thấy.
         */
        await pool.query(
          `UPDATE login_failure SET updated_at = now() - interval '30 days',
                                    locked_until = now() + interval '10 minutes'`,
        );

        await service.pruneStale();

        const left = await pool.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM login_failure',
        );
        // Khoá còn hiệu lực thì hàng phải ở lại.
        expect(left.rows[0].n).toBe(1);
      },
      TEST_TIMEOUT,
    );

    it(
      'hàng cũ mà khoá ĐÃ HẾT HẠN thì dọn được — nếu không thì sweeper vô dụng',
      async () => {
        await failFrom(IP_A, POLICY.maxFailedAttempts);
        await pool.query(
          `UPDATE login_failure SET updated_at = now() - interval '30 days',
                                    locked_until = now() - interval '1 minute'`,
        );

        await service.pruneStale();

        const left = await pool.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM login_failure',
        );
        expect(left.rows[0].n).toBe(0);
      },
      TEST_TIMEOUT,
    );
  });

  it('không lấy được IP thì vẫn có khoá, và là ĐÚNG khoá mà LoginRateGuard dùng', () => {
    /*
     * Nhánh này chỉ xảy ra khi cấu hình proxy hỏng. Gộp mọi request không có IP vào một khoá
     * là cố ý — thà siết chặt hơn mức cần còn hơn để hở. Nhưng chuỗi phải TRÙNG với chuỗi
     * `LoginRateGuard` dùng (`request.ip ?? 'unknown'`), nếu không hai hàng rào chia thế giới
     * theo hai cách khác nhau.
     */
    expect(LoginFailureService.keyFor(null)).toBe('unknown');
    expect(LoginFailureService.keyFor(undefined)).toBe('unknown');
    expect(LoginFailureService.keyFor('10.0.0.1')).toBe('10.0.0.1');
  });
});
