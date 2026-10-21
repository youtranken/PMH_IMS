import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { runMigrations } from '../src/database/migration-runner';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { SESSION_COOKIE } from '../src/modules/auth/cookie';
import { SessionGuard } from '../src/modules/auth/session.guard';
import { SessionService } from '../src/modules/auth/session.service';
import type { AuthedRequest } from '../src/modules/auth/types';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

const TEST_TIMEOUT = 120_000;

/** Q-31: ràng buộc của bảng nhóm quyền trên DB trắng + SessionGuard đọc nhóm mỗi request. */
describe('Q-31 · nhóm quyền của Thành viên', () => {
  let scratch: ScratchDb;
  let sessions: SessionService;
  let guard: SessionGuard;
  let seq = 0;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_feature_group');
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
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function group(name: string, features: string[]): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO feature_group (name, features) VALUES ($1, $2) RETURNING id`,
      [name, features],
    );
    return rows[0].id;
  }

  async function user(role: string, groupId: string | null = null): Promise<string> {
    seq += 1;
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, must_change_password, feature_group_id)
       VALUES ($1, 'E2E Nhóm quyền', $2, 'x', false, $3) RETURNING id`,
      [`e2e-nhom-quyen-${seq}@pmh.com.vn`, role, groupId],
    );
    return rows[0].id;
  }

  async function guardedRequest(userId: string): Promise<AuthedRequest> {
    const created = await scratch.db.transaction((tx) =>
      sessions.createWithin(tx, { userId, ip: '10.0.0.1', userAgent: 'jest', absoluteHours: 12, totpPending: false }),
    );
    const request = { cookies: { [SESSION_COOKIE]: created.token } } as unknown as AuthedRequest;
    const ctx = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    return request;
  }

  describe('ràng buộc DB', () => {
    it('nhóm không có ô tick nào bị từ chối', async () => {
      await expect(group('E2E rỗng', [])).rejects.toThrow(/feature_group_features_check/);
    });

    it('khóa suy ra (expiry, iso) hay khóa lạ không lưu được vào nhóm', async () => {
      await expect(group('E2E suy ra', ['expiry'])).rejects.toThrow(/feature_group_features_check/);
      await expect(group('E2E lạ', ['network', 'bogus'])).rejects.toThrow(/feature_group_features_check/);
    });

    it('tên trùng không phân biệt hoa thường', async () => {
      await group('E2E Mạng trùng', ['network']);
      await expect(group('e2e mạng TRÙNG', ['assets'])).rejects.toThrow(/feature_group_name_key/);
    });

    it('chỉ Member được gán nhóm', async () => {
      const id = await group('E2E chỉ member', ['network']);
      await expect(user('admin', id)).rejects.toThrow(/users_feature_group_member_check/);
      const memberId = await user('member', id);
      await expect(
        scratch.pool.query(`UPDATE users SET role = 'sa' WHERE id = $1`, [memberId]),
      ).rejects.toThrow(/users_feature_group_member_check/);
    });

    it('xoá nhóm còn người bị chặn', async () => {
      const id = await group('E2E còn người', ['assets']);
      await user('member', id);
      await expect(scratch.pool.query(`DELETE FROM feature_group WHERE id = $1`, [id])).rejects.toThrow(
        /users_feature_group_id_fkey/,
      );
    });
  });

  describe('SessionGuard gắn tính năng vào request', () => {
    it('Member chưa gán nhóm: không giới hạn', async () => {
      const req = await guardedRequest(await user('member'));
      expect(req.user?.features).toBeNull();
    });

    it('Member trong nhóm: đúng ô tick + khóa suy ra', async () => {
      // Ghi thẳng SQL, không có 0206: quyền vẫn kéo 0206 theo 0208.
      const id = await group('E2E Tài sản', ['overview', 'assets', 'iso_0208']);
      const req = await guardedRequest(await user('member', id));
      expect(req.user?.features).toEqual(['overview', 'assets', 'iso_0206', 'iso_0208', 'expiry', 'iso']);
    });

    it('SA đổi ô tick là có hiệu lực ở request kế tiếp, không cần đăng nhập lại', async () => {
      const id = await group('E2E đổi tick', ['network']);
      const memberId = await user('member', id);
      expect((await guardedRequest(memberId)).user?.features).toEqual(['network']);
      await scratch.pool.query(`UPDATE feature_group SET features = $2 WHERE id = $1`, [id, ['assets']]);
      expect((await guardedRequest(memberId)).user?.features).toEqual(['assets']);
    });

    it('SA/Admin không bao giờ bị giới hạn', async () => {
      const req = await guardedRequest(await user('admin'));
      expect(req.user?.features).toBeNull();
    });
  });
});
