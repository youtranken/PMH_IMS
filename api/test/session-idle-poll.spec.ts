import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { runMigrations } from '../src/database/migration-runner';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { SessionGuard } from '../src/modules/auth/session.guard';
import { SessionService } from '../src/modules/auth/session.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersService } from '../src/modules/users/users.service';
import { BreakGlassController } from '../src/modules/vault/break-glass.controller';
import { VaultController } from '../src/modules/vault/vault.controller';
import { SESSION_COOKIE } from '../src/modules/auth/cookie';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * NFR-01 — idle 30 phút phải CÒN là idle 30 phút khi màn hình tự hỏi định kỳ.
 *
 * Đòn: một tab SA/Admin bỏ mở trên máy dùng chung. Shell hỏi `break-glass/pending/count` mỗi
 * phút, panel két hỏi `secrets/verdict` mỗi 15 giây khi có phiếu treo. Nếu mỗi lượt hỏi đó đều
 * gia hạn `last_seen_at` thì phiên không bao giờ chết, và người kế tiếp ngồi vào máy có sẵn
 * quyền của người trước.
 *
 * Bài chạy guard THẬT trên DB THẬT, với handler lấy từ controller THẬT — nên nó đỏ cả khi
 * guard quên đọc cờ, lẫn khi route hỏi định kỳ quên gắn `@NoIdleTouch()`.
 */

const TEST_TIMEOUT = 120_000;
const IDLE_MINUTES = 30;

describe('NFR-01 · route hỏi định kỳ không gia hạn phiên idle', () => {
  let scratch: ScratchDb;
  let sessions: SessionService;
  let guard: SessionGuard;
  let touchSpy: jest.SpyInstance;
  let userId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_session_idle_poll');
    await runMigrations(scratch.pool, migrationsDir(), {
      log: () => undefined,
    });
    sessions = new SessionService(scratch.db, {} as SystemConfigService, {} as SweepService);
    const config = {
      getNumber: (key: string) =>
        key === 'sessionIdleMinutes'
          ? Promise.resolve(IDLE_MINUTES)
          : Promise.reject(new Error(`khoá không ngờ tới: ${key}`)),
    } as unknown as SystemConfigService;
    guard = new SessionGuard(
      new Reflector(),
      sessions,
      new UsersService(scratch.db),
      config,
      scratch.db,
      new AuditWriterService(scratch.db),
    );
    touchSpy = jest.spyOn(sessions, 'touch');
    const rows = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, must_change_password)
       VALUES ('idle-poll@pmh.com.vn', 'Idle Poll', 'sa', 'x', false) RETURNING id`,
    );
    userId = rows.rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    touchSpy?.mockRestore();
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function newSessionSeenMinutesAgo(minutes: number) {
    const created = await scratch.db.transaction((tx) =>
      sessions.createWithin(tx, {
        userId,
        ip: '10.0.0.1',
        userAgent: 'jest',
        absoluteHours: 12,
        totpPending: false,
      }),
    );
    await scratch.pool.query(
      `UPDATE sessions SET last_seen_at = now() - make_interval(mins => $2) WHERE id = $1`,
      [created.id, minutes],
    );
    return created;
  }

  async function lastSeen(id: string): Promise<Date> {
    const { rows } = await scratch.pool.query<{ last_seen_at: Date }>(
      `SELECT last_seen_at FROM sessions WHERE id = $1`,
      [id],
    );
    return rows[0].last_seen_at;
  }

  function contextFor(token: string, cls: object, handler: unknown): ExecutionContext {
    const request = { cookies: { [SESSION_COOKIE]: token } };
    return {
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  /** `touch` chạy kiểu bắn-rồi-quên trong guard; chờ nó xong mới đọc DB, không chờ bằng giờ. */
  async function callGuard(ctx: ExecutionContext) {
    touchSpy.mockClear();
    const result = await guard.canActivate(ctx);
    await Promise.all(touchSpy.mock.results.map((r) => r.value as Promise<void>));
    return result;
  }

  /** Handler thật của controller — Reflector đọc metadata gắn trên chính hàm này. */
  function handlerOf(cls: { prototype: object }, name: string): unknown {
    return (cls.prototype as Record<string, unknown>)[name];
  }

  const polled: Array<[string, object, unknown]> = [
    [
      'break-glass/pending/count',
      BreakGlassController,
      handlerOf(BreakGlassController, 'pendingCount'),
    ],
    ['secrets/verdict', VaultController, handlerOf(VaultController, 'verdict')],
  ];

  it.each(polled)('%s không làm last_seen_at tiến', async (_name, cls, handler) => {
    const created = await newSessionSeenMinutesAgo(20);
    const before = await lastSeen(created.id);

    await expect(callGuard(contextFor(created.token, cls, handler))).resolves.toBe(true);

    expect(touchSpy).not.toHaveBeenCalled();
    expect((await lastSeen(created.id)).getTime()).toBe(before.getTime());
  });

  it('route thường vẫn gia hạn (đối chứng: cờ không được tắt touch cho cả hệ)', async () => {
    const created = await newSessionSeenMinutesAgo(20);
    const before = await lastSeen(created.id);

    await expect(
      callGuard(
        contextFor(created.token, BreakGlassController, handlerOf(BreakGlassController, 'pending')),
      ),
    ).resolves.toBe(true);

    expect(touchSpy).toHaveBeenCalledWith(created.id);
    expect((await lastSeen(created.id)).getTime()).toBeGreaterThan(before.getTime());
  });

  it('dựng lại đòn: tab chỉ còn hỏi định kỳ thì phiên vẫn chết đúng hạn idle', async () => {
    const created = await newSessionSeenMinutesAgo(IDLE_MINUTES - 1);
    const [, cls, handler] = polled[0];

    // Một phút còn lại: vòng hỏi vẫn chạy được, nhưng không kéo dài phiên thêm giây nào.
    for (let i = 0; i < 3; i += 1) {
      await expect(callGuard(contextFor(created.token, cls, handler))).resolves.toBe(true);
    }

    // Tua đồng hồ qua mốc idle — y như tab bỏ mở thêm vài phút.
    await scratch.pool.query(
      `UPDATE sessions SET last_seen_at = last_seen_at - interval '2 minutes' WHERE id = $1`,
      [created.id],
    );
    await expect(callGuard(contextFor(created.token, cls, handler))).rejects.toMatchObject({
      response: { code: 'SESSION_EXPIRED' },
    });
  });
});
