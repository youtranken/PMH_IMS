import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { runMigrations } from '../src/database/migration-runner';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { SESSION_COOKIE } from '../src/modules/auth/cookie';
import { SessionGuard } from '../src/modules/auth/session.guard';
import { SessionService } from '../src/modules/auth/session.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, waitForLock, type ScratchDb } from './db';

/**
 * Q-20 — phiên chờ NHẬP MÃ 2 lớp sống tối đa `auth.totp_challenge_minutes` phút (seed 5) kể từ
 * lúc tạo. Quá hạn thì guard thu hồi phiên, ghi nhật ký và trả 401 — kể cả ở route được phép
 * khi đang chờ mã (`me`, nhập mã). Luồng CÀI 2 lớp bắt buộc không bị cắt.
 *
 * Guard thật, cấu hình đọc từ DB trắng vừa migrate (nên cũng chứng minh migration seed khoá).
 */

const TEST_TIMEOUT = 120_000;

describe('Q-20 · phiên chờ mã 2 lớp có hạn', () => {
  let scratch: ScratchDb;
  let sessions: SessionService;
  let guard: SessionGuard;
  let enrolledId: string;
  let newcomerId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_totp_challenge_expiry');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const config = new SystemConfigService(scratch.db);
    sessions = new SessionService(scratch.db, config, {} as SweepService);
    guard = new SessionGuard(
      new Reflector(),
      sessions,
      new UsersService(scratch.db),
      config,
      scratch.db,
      new AuditWriterService(scratch.db),
    );
    const enrolled = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, must_change_password, totp_enrolled_at)
       VALUES ('e2e-totp-challenge@pmh.com.vn', 'E2E Totp Challenge', 'member', 'x', false, now())
       RETURNING id`,
    );
    enrolledId = enrolled.rows[0].id;
    const newcomer = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, must_change_password)
       VALUES ('e2e-totp-newcomer@pmh.com.vn', 'E2E Totp Newcomer', 'member', 'x', true)
       RETURNING id`,
    );
    newcomerId = newcomer.rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function pendingSessionAged(userId: string, minutes: number) {
    const created = await scratch.db.transaction((tx) =>
      sessions.createWithin(tx, {
        userId,
        ip: '10.0.0.1',
        userAgent: 'jest',
        absoluteHours: 12,
        totpPending: true,
      }),
    );
    // Chỉ lùi `created_at`; `last_seen_at` để mới — chứng minh luật đo theo tuổi phiên.
    await scratch.pool.query(
      `UPDATE sessions SET created_at = now() - make_interval(secs => $2) WHERE id = $1`,
      [created.id, minutes * 60],
    );
    return created;
  }

  /** `me` mang `@AllowTotpPending()` — route phiên chờ được gọi hợp lệ. */
  function meContext(token: string): ExecutionContext {
    const request = { cookies: { [SESSION_COOKIE]: token } };
    return {
      getHandler: () => (AuthController.prototype as unknown as Record<string, unknown>).me,
      getClass: () => AuthController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  async function sessionRow(id: string) {
    const { rows } = await scratch.pool.query<{ revoked_at: Date | null; revoked_reason: string | null }>(
      `SELECT revoked_at, revoked_reason FROM sessions WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  async function auditCount(sessionId: string): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log WHERE action = 'auth.totp.challenge_expired' AND object_id = $1`,
      [sessionId],
    );
    return Number(rows[0].n);
  }

  /**
   * Hai request song song cùng mang phiên đã quá hạn: cả hai đọc phiên lúc nó còn sống, rồi cùng
   * vào nhánh thu hồi. Chỉ lượt THẬT SỰ thu hồi được ghi nhật ký. Dàn cảnh tất định: một kết nối
   * giữ khoá hàng phiên, đợi đủ hai lượt đứng chờ khoá, rồi mới nhả.
   */
  async function raceTwo(sessionId: string, run: () => Promise<unknown>) {
    const holder = await scratch.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const both = Promise.allSettled([run(), run()]);
      await waitForLock(scratch.pool, 10_000, 2);
      await holder.query('COMMIT');
      return await both;
    } finally {
      holder.release();
    }
  }

  it('seed mặc định là 5 phút', async () => {
    const { rows } = await scratch.pool.query<{ value: unknown }>(
      `SELECT value FROM system_config WHERE key = 'auth.totp_challenge_minutes'`,
    );
    expect(Number(rows[0].value)).toBe(5);
  });

  it('chờ mã 4 phút → vẫn qua cửa', async () => {
    const s = await pendingSessionAged(enrolledId, 4);
    await expect(guard.canActivate(meContext(s.token))).resolves.toBe(true);
    expect((await sessionRow(s.id)).revoked_at).toBeNull();
  });

  it('chờ mã 6 phút → 401 SESSION_EXPIRED, phiên bị thu hồi, có một dòng nhật ký', async () => {
    const s = await pendingSessionAged(enrolledId, 6);
    await expect(guard.canActivate(meContext(s.token))).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_EXPIRED', reason: 'TOTP_CHALLENGE_EXPIRED' },
    });
    const row = await sessionRow(s.id);
    expect(row.revoked_at).not.toBeNull();
    expect(row.revoked_reason).toBe('totp-challenge-expired');
    expect(await auditCount(s.id)).toBe(1);

    // Gọi lại: phiên đã thu hồi → SESSION_REVOKED, không ghi thêm nhật ký.
    await expect(guard.canActivate(meContext(s.token))).rejects.toMatchObject({ status: 401 });
    expect(await auditCount(s.id)).toBe(1);
  });

  it('hai request song song trên phiên chờ mã quá hạn → cả hai 401, chỉ MỘT dòng nhật ký', async () => {
    const s = await pendingSessionAged(enrolledId, 6);
    const results = await raceTwo(s.id, () => guard.canActivate(meContext(s.token)));
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(await auditCount(s.id)).toBe(1);
  });

  it('luồng CÀI 2 lớp bắt buộc (chưa có mã) chờ 1 giờ → không bị cắt', async () => {
    const s = await pendingSessionAged(newcomerId, 60);
    await expect(guard.canActivate(meContext(s.token))).resolves.toBe(true);
    expect((await sessionRow(s.id)).revoked_at).toBeNull();
  });
});
