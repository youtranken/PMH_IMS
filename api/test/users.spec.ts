import { runMigrations } from '../src/database/migration-runner';
import { pgConstraint, pgErrorCode } from '../src/common/sql';
import { UsersService } from '../src/modules/users/users.service';
import type { UserRole } from '../src/modules/auth/types';
import { createScratchDb, migrationsDir, waitForLock, type ScratchDb } from './db';

/**
 * `UsersService` trên DB thật — chủ bảng `users` (AD-3).
 *
 * Các cửa ở đây là nền của đăng nhập và của luật "luôn còn 2 SA" (NFR-01); lỗi của chúng
 * không lộ qua đồ giả: khoá hàng, `citext`, chỉ mục duy nhất một phần, bộ lọc trạng thái đều
 * là hành vi của Postgres.
 */

const TEST_TIMEOUT = 120_000;

describe('UsersService — tầng DB', () => {
  let scratch: ScratchDb;
  let users: UsersService;
  let seq = 0;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_users');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    users = new UsersService(scratch.db);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    // Bảng khác có thể trỏ vào `users` (phiên…), nên dọn bằng CASCADE thay vì DELETE.
    await scratch.pool.query('TRUNCATE users CASCADE');
  });

  function make(role: UserRole, extra: { email?: string; employeeCode?: string | null } = {}) {
    seq += 1;
    return scratch.db.transaction((tx) =>
      users.createWithin(tx, {
        email: extra.email ?? `u${seq}@qa.test`,
        fullName: `Người ${seq}`,
        employeeCode: extra.employeeCode ?? null,
        role,
        passwordHash: 'hash',
        totpLoginRequired: true,
      }),
    );
  }

  async function uniqueViolation(p: Promise<unknown>): Promise<string | undefined> {
    try {
      await p;
    } catch (error) {
      expect(pgErrorCode(error)).toBe('23505');
      return pgConstraint(error);
    }
    throw new Error('Không bị chặn');
  }

  describe('tạo tài khoản', () => {
    it('tài khoản mới buộc đổi mật khẩu, không lộ trường bí mật', async () => {
      const created = await make('member');
      expect(created.mustChangePassword).toBe(true);
      expect(created.status).toBe('active');
      expect(created).not.toHaveProperty('passwordHash');
      expect(created).not.toHaveProperty('totpSecretCt');
      const creds = await users.findCredentialsById(created.id);
      expect(creds?.passwordHash).toBe('hash');
    });

    it('email trùng không phân biệt hoa-thường bị chặn ở DB (citext)', async () => {
      await make('member', { email: 'trung@qa.test' });
      expect(await uniqueViolation(make('admin', { email: 'TRUNG@qa.test' }))).toBe(
        'users_email_key',
      );
      expect(await users.findCredentialsByEmail('Trung@QA.test')).not.toBeNull();
    });

    it('mã nhân viên trùng bị chặn, nhưng nhiều người cùng để trống thì không', async () => {
      await make('member', { employeeCode: 'NV-01' });
      expect(await uniqueViolation(make('member', { employeeCode: 'NV-01' }))).toBe(
        'users_employee_code_uq',
      );
      await make('member');
      await make('member');
    });
  });

  describe('đổi trạng thái', () => {
    it('khoá rồi mở lại; tài khoản không còn active thì không nhận thư', async () => {
      const a = await make('admin', { email: 'a@qa.test' });
      await make('sa', { email: 'sa@qa.test' });
      await make('member', { email: 'm@qa.test' });

      await scratch.db.transaction((tx) => users.setStatusWithin(tx, a.id, 'locked'));
      expect((await users.findById(a.id))?.status).toBe('locked');
      expect((await users.listRecipients(['sa', 'admin'])).map((r) => r.email)).toEqual([
        'sa@qa.test',
      ]);

      await scratch.db.transaction((tx) => users.setStatusWithin(tx, a.id, 'active'));
      expect(
        (await users.listRecipients(['sa', 'admin'])).map((r) => r.email).sort(),
      ).toEqual(['a@qa.test', 'sa@qa.test']);
    });

    it('trạng thái ngoài danh sách bị CHECK chặn', async () => {
      const a = await make('member');
      await expect(
        scratch.pool.query(`UPDATE users SET status = 'deleted' WHERE id = $1`, [a.id]),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('luật SA cuối cùng — countActiveSaWithin', () => {
    it('đếm SA đang hoạt động, bỏ người đang bị đổi và SA đã khoá', async () => {
      const s1 = await make('sa');
      const s2 = await make('sa');
      const s3 = await make('sa');
      await make('admin');
      await scratch.db.transaction((tx) => users.setStatusWithin(tx, s3.id, 'disabled'));

      const counts = await scratch.db.transaction(async (tx) => [
        await users.countActiveSaWithin(tx),
        await users.countActiveSaWithin(tx, s1.id),
        await users.countActiveSaWithin(tx, s3.id),
      ]);
      expect(counts).toEqual([2, 1, 2]);
      expect(s2.role).toBe('sa');
    });

    it('hai lượt khoá hai SA song song: lượt sau xếp hàng và đếm lại con số thật', async () => {
      const a = await make('sa');
      const b = await make('sa');
      await make('sa');

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let firstCounted!: () => void;
      const counted = new Promise<void>((resolve) => (firstCounted = resolve));

      const first = scratch.db.transaction(async (tx) => {
        const remaining = await users.countActiveSaWithin(tx, a.id);
        firstCounted();
        await gate;
        await users.setStatusWithin(tx, a.id, 'locked');
        return remaining;
      });
      await counted;

      const second = scratch.db.transaction(async (tx) => {
        const remaining = await users.countActiveSaWithin(tx, b.id);
        if (remaining >= 2) await users.setStatusWithin(tx, b.id, 'locked');
        return remaining;
      });
      // Lượt sau PHẢI đứng chờ khoá; không đứng thì hai lượt cùng đọc "còn 2".
      // Mở cổng cả khi hỏng, nếu không lượt đầu treo và giữ kết nối tới lúc xoá DB.
      try {
        await waitForLock(scratch.pool, 3_000);
      } finally {
        release();
      }

      expect(await first).toBe(2);
      expect(await second).toBe(1);
      const { rows } = await scratch.pool.query(
        `SELECT count(*)::int AS n FROM users WHERE role = 'sa' AND status = 'active'`,
      );
      expect(rows[0].n).toBe(2);
    });
  });

  describe('đếm lượt sai đăng nhập', () => {
    const policy = { threshold: 3, stepsMinutes: [5, 15] };
    const now = new Date('2026-09-27T01:00:00Z');

    it('đủ ngưỡng thì khoá tạm; clearLoginFailures xoá cả bộ đếm lẫn mốc khoá', async () => {
      const u = await make('member');
      const results = [];
      for (let i = 0; i < 3; i += 1) {
        results.push(
          await scratch.db.transaction((tx) =>
            users.registerLoginFailureWithin(tx, u.id, policy, now),
          ),
        );
      }
      expect(results.map((r) => r.justLocked)).toEqual([false, false, true]);
      expect(results[2].lockedUntil?.toISOString()).toBe('2026-09-27T01:05:00.000Z');
      const locked = await users.findCredentialsById(u.id);
      expect(locked?.failedAttempts).toBe(3);

      await users.clearLoginFailures(u.id);
      const cleared = await users.findCredentialsById(u.id);
      expect(cleared?.failedAttempts).toBe(0);
      expect(cleared?.lockedUntil).toBeNull();
      // Mật khẩu đúng chưa phải đăng nhập xong — mốc lần vào cuối không được nhảy.
      expect(cleared?.lastLoginAt).toBeNull();
    });

    it('N lượt sai song song đếm đủ N (FOR UPDATE), không mất lượt nào', async () => {
      const u = await make('member');
      const wide = { threshold: 0, stepsMinutes: [] };
      await Promise.all(
        Array.from({ length: 6 }, () =>
          scratch.db.transaction((tx) => users.registerLoginFailureWithin(tx, u.id, wide, now)),
        ),
      );
      expect((await users.findCredentialsById(u.id))?.failedAttempts).toBe(6);
    });

    it('tài khoản không tồn tại thì không ghi gì và không ném', async () => {
      const r = await scratch.db.transaction((tx) =>
        users.registerLoginFailureWithin(tx, '00000000-0000-0000-0000-000000000000', policy, now),
      );
      expect(r).toEqual({ failedAttempts: 0, lockedUntil: null, justLocked: false });
    });
  });

  describe('tra tên và người nhận', () => {
    it('namesByEmails tra được bất kể hoa-thường, khoá map là chữ thường', async () => {
      await make('member', { email: 'Sep@QA.test' });
      const map = await users.namesByEmails(['sep@qa.test', 'khong-co@qa.test']);
      expect([...map.keys()]).toEqual(['sep@qa.test']);
      // Nơi gọi tra bằng email thô như đang lưu ở bảng khác (approval.requester, …).
      expect(map.get('Sep@QA.test')).toBe(map.get('sep@qa.test'));
      expect(map.get('SEP@qa.TEST')).toBeDefined();
      expect(map.has('Sep@QA.test')).toBe(true);
      expect((await users.namesByEmails([])).size).toBe(0);
    });

    it('listRecipients chỉ lấy đúng vai được hỏi', async () => {
      await make('sa', { email: 'sa1@qa.test' });
      await make('admin', { email: 'ad1@qa.test' });
      await make('member', { email: 'mb1@qa.test' });
      expect((await users.listRecipients(['admin'])).map((r) => r.email)).toEqual([
        'ad1@qa.test',
      ]);
      expect(await users.listRecipients([])).toEqual([]);
    });
  });
});
