import { Pool } from 'pg';
import { runMigrations } from '../src/database/migration-runner';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { AuditQueryService } from '../src/modules/audit/audit-query.service';
import { SECURITY_AUDIT_ACTIONS } from '../src/modules/audit/security-actions';
import { AuditObjectLabelRegistry } from '../src/common/audit-object-labels.registry';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Bộ lọc của màn Nhật ký (DOM-07) trên Postgres THẬT: câu hỏi là Postgres hiểu `LIKE` và
 * `AT TIME ZONE` ra sao, nên chỉ Postgres trả lời được.
 */

const TEST_TIMEOUT = 180_000;

describe('Bộ lọc nhật ký an ninh', () => {
  let scratch: ScratchDb;
  let pool: Pool;

  /** Service mới mỗi lần — `SystemConfigService` giữ cache, đổi cấu hình rồi phải dựng lại. */
  const makeService = () =>
    new AuditQueryService(
      scratch.db,
      new UsersApiService(new UsersService(scratch.db)),
      new SystemConfigService(scratch.db),
      new AuditObjectLabelRegistry(),
    );

  beforeAll(async () => {
    scratch = await createScratchDb('ims_audit_filters');
    await runMigrations(scratch.pool, migrationsDir(), {
      log: () => undefined,
    });
    pool = scratch.pool;
    await pool.query(
      `INSERT INTO audit_log (actor, action, object_type, object_id, created_at) VALUES
         ('le_minh@pmh.com.vn', 'test.escape', 'device', 'a_b',  now()),
         ('lexminh@pmh.com.vn', 'test.escape', 'device', 'axb',  now()),
         ('tz@pmh.com.vn',      'test.tz',     'device', 'tz-1', '2026-03-10T20:00:00Z')`,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it(
    '`_` trong email là chữ thường, không phải ký tự đại diện — không kéo hoạt động người khác vào',
    async () => {
      const page = await makeService().listAudit({
        actor: 'le_minh',
        page: 1,
        pageSize: 50,
      });
      expect(page.items.map((r) => r.actor)).toEqual(['le_minh@pmh.com.vn']);
    },
    TEST_TIMEOUT,
  );

  it(
    'lọc theo đối tượng cũng escape',
    async () => {
      const page = await makeService().listAudit({
        objectId: 'a_b',
        page: 1,
        pageSize: 50,
      });
      expect(page.items.map((r) => r.objectId)).toEqual(['a_b']);
    },
    TEST_TIMEOUT,
  );

  /*
   * Dòng lúc 20:00 UTC ngày 10/03 = 03:00 sáng 11/03 giờ VN. Hai múi cho hai ngày khác nhau,
   * nên hai ca dưới chỉ cùng xanh khi ranh giới ngày thật sự đọc từ `app.timezone`.
   */
  it(
    'múi giờ mặc định (Asia/Ho_Chi_Minh): dòng thuộc ngày 11/03',
    async () => {
      const service = makeService();
      const d11 = await service.listAudit({
        action: 'test.tz',
        from: '2026-03-11',
        to: '2026-03-11',
        page: 1,
        pageSize: 50,
      });
      const d10 = await service.listAudit({
        action: 'test.tz',
        from: '2026-03-10',
        to: '2026-03-10',
        page: 1,
        pageSize: 50,
      });
      expect(d11.total).toBe(1);
      expect(d10.total).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    'đổi `app.timezone` sang UTC thì dòng chuyển sang ngày 10/03',
    async () => {
      await pool.query(`UPDATE system_config SET value = '"UTC"' WHERE key = 'app.timezone'`);
      const service = makeService();
      const d10 = await service.listAudit({
        action: 'test.tz',
        from: '2026-03-10',
        to: '2026-03-10',
        page: 1,
        pageSize: 50,
      });
      const d11 = await service.listAudit({
        action: 'test.tz',
        from: '2026-03-11',
        to: '2026-03-11',
        page: 1,
        pageSize: 50,
      });
      expect(d10.total).toBe(1);
      expect(d11.total).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    'chỉ sự kiện an ninh: lấy đúng tập mã an ninh, bỏ mọi dòng thường',
    async () => {
      await pool.query(
        `INSERT INTO audit_log (actor, action, object_type, object_id) VALUES
           ('sec@qa.test', 'auth.login.failed', 'user', 'sec-1'),
           ('sec@qa.test', 'vault.secret.reveal_denied', 'secret', 'sec-2'),
           ('sec@qa.test', 'device.updated', 'device', 'sec-3')`,
      );
      const page = await makeService().listAudit({
        actor: 'sec@qa.test',
        security: true,
        page: 1,
        pageSize: 50,
      });
      expect(page.items.map((r) => r.action).sort()).toEqual([
        'auth.login.failed',
        'vault.secret.reveal_denied',
      ]);
      expect(page.total).toBe(2);
      for (const action of page.items.map((r) => r.action)) {
        expect(SECURITY_AUDIT_ACTIONS).toContain(action);
      }
    },
    TEST_TIMEOUT,
  );
});
