import { Pool, type PoolClient } from 'pg';
import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * ĐỐT MÃ TOTP — chống replay chỉ đúng khi lượt GHI tự nó loại trừ được lượt kia.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `users.service.ts` có một khối chú thích dài giải thích vì sao `setTotpLastTimestepWithin`
 * phải nằm TRONG transaction cấp phiên, và kết luận: "hoặc người dùng vào được VÀ mã bị đốt,
 * hoặc không có gì xảy ra. Không còn trạng thái ở giữa."
 *
 * Câu đó đúng với SỰ CỐ (DB chớp, pool cạn, worker bị kill) và sai với ĐỒNG THỜI. Lượt ĐỌC —
 * `requireUser()` rồi `totp.verify({ lastUsedTimeStep: user.totpLastTimestep })` — vẫn chạy
 * trên pool, NGOÀI transaction, và câu ghi là `UPDATE ... SET totp_last_timestep = $1 WHERE
 * id = $2`: vô điều kiện, không `FOR UPDATE`, không vị từ trên giá trị cũ. Mức cô lập là
 * READ COMMITTED (không chỗ nào trong repo đặt khác).
 *
 * Nên trình tự này lọt, không cần lỗi gì:
 *
 *     T1 đọc last = 100  ·  T2 đọc last = 100     (cùng một mã 6 số, timestep 101)
 *     T1 verify OK       ·  T2 verify OK
 *     T1 UPDATE → 101, COMMIT
 *     T2 UPDATE → 101, COMMIT
 *
 * MỘT mã 6 số đổi ra HAI phiên đã step-up — đúng thứ NFR-01 sinh ra để chặn. Đây là ca
 * AitM/proxy phishing: kẻ tấn công chộp mã nạn nhân đang gửi rồi bắn song song thay vì gửi
 * lại sau (gửi lại thì bị chặn đúng).
 *
 * Hệ quả thứ hai cùng gốc: `epochTolerance` cho phép nhận cả timestep liền trước, nên hai lượt
 * song song ở hai timestep khác nhau có thể ghi mốc LÙI LẠI (T1 ghi 101, T2 ghi 100) — và mã
 * 101 dùng lại được.
 *
 * ===== VÌ SAO Ở TẦNG NÀY =====
 *
 * Cuộc đua nằm ở KHOẢNG GIỮA hai câu lệnh SQL trên hai kết nối thật. Unit test không có
 * transaction để mà đua (và CLAUDE.md cấm mock drizzle). E2E cũng không: sáu request qua một
 * `APIRequestContext` không chồng lên nhau đủ để mở khe hở — tôi đã đo chuyện đó ở
 * `ip-restore-guard.spec.ts` và bỏ bài E2E tương ứng vì nó xanh cả trên code chưa vá.
 *
 * ===== GIỚI HẠN, NÓI THẲNG =====
 *
 * Bài này khoá hợp đồng của CÂU SQL, không chứng minh service phát ra đúng câu đó — cùng giới
 * hạn đã ghi ở `subnet-cidr-race.spec.ts`. Vế còn lại do `auth.spec.ts` giữ: nó chạy replay tuần
 * tự qua service thật và đòi đúng chữ "đã được dùng".
 */

const TEST_TIMEOUT = 120_000;

/** Câu ghi CŨ — giữ lại làm vế đối chứng, xem `it` thứ nhất. */
const BURN_UNCONDITIONAL = `UPDATE users SET totp_last_timestep = $1 WHERE id = $2`;

/**
 * Câu ghi MỚI. Hai vị từ, hai việc khác nhau:
 *   · `IS NULL` — lần đốt đầu tiên của một tài khoản vừa enroll.
 *   · `< $1`    — chỉ tiến, không lùi. Chặn luôn cả ca ghi lùi do `epochTolerance`.
 */
const BURN_CAS = `UPDATE users
     SET totp_last_timestep = $1
   WHERE id = $2 AND (totp_last_timestep IS NULL OR totp_last_timestep < $1)`;

describe('Đốt mã TOTP phải loại trừ được lượt song song', () => {
  let scratch: ScratchDb;
  let pool: Pool;
  let userId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_totp_cas');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    pool = scratch.pool;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await pool.query(`DELETE FROM users WHERE email = 'totp-cas@pmh.com.vn'`);
    const rows = await pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, totp_last_timestep)
       VALUES ('totp-cas@pmh.com.vn', 'Đua TOTP', 'member', 'x', 100) RETURNING id`,
    );
    userId = rows.rows[0].id;
  });

  /** Hai transaction chồng nhau, cùng một timestep — ép ra đúng khe hở, không trông vào may rủi. */
  async function race(
    statement: string,
    stepA: number,
    stepB: number,
  ): Promise<{ a: number | null; b: number | null; stored: string | null }> {
    let a: PoolClient | undefined;
    let b: PoolClient | undefined;
    try {
      a = await pool.connect();
      b = await pool.connect();
      await a.query('BEGIN');
      await b.query('BEGIN');

      const first = await a.query(statement, [stepA, userId]);
      // B đâm vào cùng hàng: chặn ở khoá hàng tới khi A commit, rồi ĐỌC LẠI phiên bản mới.
      const pending = b.query(statement, [stepB, userId]);
      await a.query('COMMIT');
      const second = await pending;
      await b.query('COMMIT');

      const stored = await pool.query<{ totp_last_timestep: string | null }>(
        `SELECT totp_last_timestep FROM users WHERE id = $1`,
        [userId],
      );
      return {
        a: first.rowCount,
        b: second.rowCount,
        stored: stored.rows[0].totp_last_timestep,
      };
    } finally {
      a?.release();
      b?.release();
    }
  }

  /**
   * VẾ ĐỐI CHỨNG — chứng minh lỗ có thật trước khi khẳng định bản vá đóng được nó.
   * Không có `it` này thì `it` dưới chỉ nói "SQL có vị từ thì lọc", một câu vô nghĩa.
   */
  it('câu ghi VÔ ĐIỀU KIỆN cho cả hai lượt cùng thắng — một mã ra hai phiên', async () => {
    const r = await race(BURN_UNCONDITIONAL, 101, 101);
    expect(r.a).toBe(1);
    expect(r.b).toBe(1);
  });

  it('câu ghi CÓ VỊ TỪ: lượt thứ hai khớp 0 dòng', async () => {
    const r = await race(BURN_CAS, 101, 101);
    expect(r.a).toBe(1);
    expect(r.b).toBe(0);
    expect(r.stored).toBe('101');
  });

  /**
   * `epochTolerance` nhận cả timestep liền trước, nên hai lượt song song có thể mang hai
   * timestep khác nhau. Mốc KHÔNG được đi lùi: lùi là mở lại đúng cái mã vừa đốt.
   */
  it('câu ghi CÓ VỊ TỪ: mốc không bao giờ đi lùi', async () => {
    const r = await race(BURN_CAS, 101, 100);
    expect(r.a).toBe(1);
    expect(r.b).toBe(0);
    expect(r.stored).toBe('101');
  });

  it('câu ghi VÔ ĐIỀU KIỆN thì mốc ĐI LÙI — mã vừa đốt sống lại', async () => {
    const r = await race(BURN_UNCONDITIONAL, 101, 100);
    expect(r.stored).toBe('100');
  });

  /** Lần đốt đầu tiên sau khi enroll: cột còn NULL, phải ghi được. */
  it('mốc còn NULL thì lượt đốt đầu tiên phải qua', async () => {
    await pool.query(`UPDATE users SET totp_last_timestep = NULL WHERE id = $1`, [userId]);
    const first = await pool.query(BURN_CAS, [77, userId]);
    expect(first.rowCount).toBe(1);
  });
});
