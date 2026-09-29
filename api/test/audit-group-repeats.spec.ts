import { Pool } from 'pg';
import { runMigrations } from '../src/database/migration-runner';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { AuditQueryService } from '../src/modules/audit/audit-query.service';
import { AuditObjectLabelRegistry } from '../src/common/audit-object-labels.registry';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * ADM-065: nhật ký gom sự kiện GIỐNG HỆT lặp LIỀN NHAU (cùng người, cùng hành động, cùng đối
 * tượng, cùng phút) thành một dòng ×N. Gom ở API — gom ở trình duyệt thì trang 2 bắt đầu giữa
 * một cụm và tổng số dòng nói sai. Chạy trên Postgres thật vì cách gom là hàm cửa sổ của DB.
 */

const TEST_TIMEOUT = 180_000;

describe('Nhật ký · gom sự kiện lặp liền nhau', () => {
  let scratch: ScratchDb;
  let pool: Pool;

  const service = () =>
    new AuditQueryService(
      scratch.db,
      new UsersApiService(new UsersService(scratch.db)),
      new SystemConfigService(scratch.db),
      new AuditObjectLabelRegistry(),
    );

  beforeAll(async () => {
    scratch = await createScratchDb('ims_audit_group');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    pool = scratch.pool;
    /*
     * Mới nhất ở trên (thứ tự màn hiện):
     *   10:05:40  a  x.saved    dev-1     ─┐ cụm 3 (cùng phút 10:05)
     *   10:05:30  a  x.saved    dev-1      │
     *   10:05:10  a  x.saved    dev-1     ─┘
     *   10:05:05  b  x.saved    dev-1        khác người → dòng riêng
     *   10:05:01  a  x.saved    dev-1        cùng khóa nhưng bị b chen giữa → KHÔNG liền nhau
     *   10:04:59  a  x.saved    dev-1        khác phút → dòng riêng
     *   10:04:50  a  x.saved    dev-2        khác đối tượng
     *   10:04:40  a  auth.fail  (null)    ─┐ cụm 2, đối tượng null vẫn gom
     *   10:04:30  a  auth.fail  (null)    ─┘
     */
    await pool.query(
      `INSERT INTO audit_log (actor, action, object_type, object_id, ip, detail, created_at) VALUES
         ('a@pmh.com.vn', 'x.saved',   'device', 'dev-1', '10.0.0.3', '{"n":3}', '2026-09-01T10:05:40Z'),
         ('a@pmh.com.vn', 'x.saved',   'device', 'dev-1', '10.0.0.2', '{"n":2}', '2026-09-01T10:05:30Z'),
         ('a@pmh.com.vn', 'x.saved',   'device', 'dev-1', '10.0.0.1', '{"n":1}', '2026-09-01T10:05:10Z'),
         ('b@pmh.com.vn', 'x.saved',   'device', 'dev-1', null,       null,      '2026-09-01T10:05:05Z'),
         ('a@pmh.com.vn', 'x.saved',   'device', 'dev-1', null,       null,      '2026-09-01T10:05:01Z'),
         ('a@pmh.com.vn', 'x.saved',   'device', 'dev-1', null,       null,      '2026-09-01T10:04:59Z'),
         ('a@pmh.com.vn', 'x.saved',   'device', 'dev-2', null,       null,      '2026-09-01T10:04:50Z'),
         ('a@pmh.com.vn', 'auth.fail', null,     null,    null,       null,      '2026-09-01T10:04:40Z'),
         ('a@pmh.com.vn', 'auth.fail', null,     null,    null,       null,      '2026-09-01T10:04:30Z')`,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('không bật gom: 9 dòng như cũ, không mang số lần', async () => {
    const page = await service().listAudit({ page: 1, pageSize: 50 });
    expect(page.total).toBe(9);
    expect(page.items.every((row) => row.count === undefined)).toBe(true);
  });

  it(
    'bật gom: 6 dòng; cụm mang ×N, mốc đầu–cuối và từng sự kiện (mới nhất trước)',
    async () => {
      const page = await service().listAudit({ page: 1, pageSize: 50, group: true });
      expect(page.total).toBe(6);
      expect(page.items.map((row) => [row.actor[0], row.objectId, row.count ?? 1])).toEqual([
        ['a', 'dev-1', 3],
        ['b', 'dev-1', 1],
        ['a', 'dev-1', 1],
        ['a', 'dev-1', 1],
        ['a', 'dev-2', 1],
        ['a', null, 2],
      ]);
      const burst = page.items[0];
      // Dòng đại diện là sự kiện MỚI NHẤT của cụm — đúng thứ màn không gom hiện ở vị trí đó.
      expect(burst.createdAt).toBe('2026-09-01T10:05:40.000Z');
      expect(burst.ip).toBe('10.0.0.3');
      expect(burst.firstAt).toBe('2026-09-01T10:05:10.000Z');
      expect(burst.events?.map((event) => [event.createdAt, event.ip, event.detail])).toEqual([
        ['2026-09-01T10:05:40.000Z', '10.0.0.3', { n: 3 }],
        ['2026-09-01T10:05:30.000Z', '10.0.0.2', { n: 2 }],
        ['2026-09-01T10:05:10.000Z', '10.0.0.1', { n: 1 }],
      ]);
      // Dòng đơn không mang danh sách sự kiện — tránh phình payload cho trường hợp thường.
      expect(page.items[1].events).toBeUndefined();
    },
    TEST_TIMEOUT,
  );

  it(
    'phân trang tính theo DÒNG ĐÃ GOM: trang 2 (cỡ 4) bắt đầu đúng sau cụm, tổng không đổi',
    async () => {
      const second = await service().listAudit({ page: 2, pageSize: 4, group: true });
      expect(second.total).toBe(6);
      expect(second.items.map((row) => [row.objectId, row.count ?? 1])).toEqual([
        ['dev-2', 1],
        [null, 2],
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'gom sau khi lọc: lọc bỏ người b thì hai dòng của a hai bên nó thành liền nhau nhưng khác phút',
    async () => {
      const page = await service().listAudit({
        page: 1,
        pageSize: 50,
        group: true,
        actor: 'a@',
        objectId: 'dev-1',
      });
      // 10:05:40/30/10/01 cùng phút 10:05 và nay liền nhau → một cụm 4; 10:04:59 riêng.
      expect(page.items.map((row) => row.count ?? 1)).toEqual([4, 1]);
    },
    TEST_TIMEOUT,
  );
});
