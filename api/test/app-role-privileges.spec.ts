import { Pool } from 'pg';
import { appRoleVerdict, ensureAppRole, readAppRoleFacts } from '../src/database/app-role';
import { runMigrations } from '../src/database/migration-runner';
import {
  appDbPassword,
  appDbUrl,
  createScratchDb,
  migrationsDir,
  type ScratchDb,
} from './db';

/**
 * D-01 — SỔ NHẬT KÝ CHỈ-THÊM CHỈ THẬT KHI ROLE ỨNG DỤNG KHÔNG PHẢI CHỦ NHÀ.
 *
 * ===== VÌ SAO BÀI NÀY PHẢI Ở TẦNG NÀY =====
 *
 * Thứ đang kiểm là PHÂN QUYỀN của Postgres, không phải một nhánh `if` trong TypeScript. Không
 * mock nào có ACL; và E2E cũng không hỏi được, vì nó đi qua HTTP bằng đúng một role.
 *
 * Chỉ hai kết nối thật — một của chủ sở hữu, một của `ims_app` — mới trả lời được câu
 * "cùng một câu lệnh, hai role, có ra hai kết quả không".
 *
 * ===== VÀ VÌ SAO NÓ KIỂM MÃ LỖI, KHÔNG CHỈ KIỂM "CÓ NÉM" =====
 *
 * `UPDATE audit_log` bị chặn bởi HAI lớp: ACL (REVOKE của 0048) và trigger append-only (0005).
 * Nếu chỉ khẳng định "câu lệnh ném lỗi" thì bài này xanh cả khi ACL không có tác dụng gì —
 * trigger một mình cũng làm nó xanh. Mà trigger là lớp CHỦ SỞ HỮU tháo được bằng một câu
 * `ALTER TABLE`; ACL mới là lớp `ims_app` không chạm tới được.
 *
 * Nên bài chốt `42501` (`insufficient_privilege`) — mã của ACL, khác hẳn `P0001` mà
 * `RAISE EXCEPTION` trong trigger sinh ra. Đó là khác biệt giữa "có hàng rào" và "có ĐÚNG
 * hàng rào mà AD-9 hứa".
 */

const TEST_TIMEOUT = 180_000;

/** Mã lỗi SQLSTATE của một câu lệnh — ném lại nếu nó KHÔNG lỗi, vì đó mới là tin xấu. */
async function sqlStateOf(pool: Pool, sql: string): Promise<string> {
  try {
    await pool.query(sql);
  } catch (error) {
    return (error as { code?: string }).code ?? 'KHÔNG-CÓ-MÃ';
  }
  throw new Error(`Câu lệnh KHÔNG bị chặn: ${sql}`);
}

describe('Role ứng dụng ims_app — hẹp đúng mức AD-9 hứa', () => {
  let scratch: ScratchDb;
  let app: Pool;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_role');
    // Role là thứ CỦA CẢ CỤM, không của một database: dựng bằng đúng hàm mà `main.ts` gọi,
    // với đúng mật khẩu trong `.env`, để bài kiểm không rút thảm dưới chân stack đang chạy.
    await ensureAppRole(scratch.pool, 'ims_app', appDbPassword());
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });

    app = new Pool({ connectionString: appDbUrl(scratch.name) });
    app.on('error', () => undefined);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await app?.end();
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('làm được việc của nó: đọc và GHI THÊM vào audit_log', async () => {
    await app.query(
      `INSERT INTO audit_log (actor, action, object_type) VALUES ('d01@test', 'probe.write', 'user')`,
    );
    const { rows } = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'probe.write'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('không SỬA, không XOÁ, không TRUNCATE được audit_log — chặn ở ACL, không phải ở trigger', async () => {
    expect(await sqlStateOf(app, `UPDATE audit_log SET actor = 'x'`)).toBe('42501');
    expect(await sqlStateOf(app, `DELETE FROM audit_log`)).toBe('42501');
    expect(await sqlStateOf(app, `TRUNCATE audit_log`)).toBe('42501');
  });

  it('không tháo được trigger append-only — đó là lỗ mà chủ sở hữu vẫn còn', async () => {
    // `ALTER TABLE ... DISABLE TRIGGER` đòi QUYỀN SỞ HỮU. Đây là câu lệnh mà `0039` tự khai
    // là lối thoát cuối cùng; nó chỉ thật sự bị bịt khi ứng dụng không sở hữu bảng.
    expect(await sqlStateOf(app, `ALTER TABLE audit_log DISABLE TRIGGER ALL`)).toBe('42501');
    expect(await sqlStateOf(app, `DROP TRIGGER audit_log_no_delete ON audit_log`)).toBe('42501');
  });

  it('vẫn đọc/ghi/xoá bình thường trên bảng nghiệp vụ', async () => {
    const type = await app.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('Loai D01') RETURNING id`,
    );
    const device = await app.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id)
       VALUES ('D01-PROBE', 'May thu D01', $1) RETURNING id`,
      [type.rows[0].id],
    );
    await app.query(`UPDATE device SET name = 'Da sua' WHERE id = $1`, [device.rows[0].id]);
    await app.query(`DELETE FROM device WHERE id = $1`, [device.rows[0].id]);
    await app.query(`DELETE FROM device_type WHERE id = $1`, [type.rows[0].id]);
  });

  it('có quyền trên bảng migration TẠO SAU nó — nhờ ALTER DEFAULT PRIVILEGES', async () => {
    /*
     * Không có quyền mặc định thì bảng của migration kế tiếp ra đời KHÔNG có quyền cho
     * `ims_app`, và lỗi hiện ra ở production dưới dạng "permission denied" giữa một nghiệp vụ
     * — chứ không phải ở đây. Bài này giả lập đúng bước đó: chủ sở hữu tạo một bảng SAU khi
     * 0048 đã chạy.
     */
    await scratch.pool.query(`CREATE TABLE late_table (id int primary key)`);
    await app.query(`INSERT INTO late_table (id) VALUES (1)`);
    await app.query(`UPDATE late_table SET id = 2 WHERE id = 1`);
    await app.query(`DELETE FROM late_table`);
    await scratch.pool.query(`DROP TABLE late_table`);
  });

  it('cổng khởi động phân biệt đúng hai role', async () => {
    // Chính câu hỏi mà `main.ts` hỏi mỗi lần boot. Chủ sở hữu phải TRƯỢT, ứng dụng phải ĐẬU —
    // nếu cả hai cùng đậu thì cổng đó không đo gì cả.
    const ownerVerdict = appRoleVerdict(await readAppRoleFacts(scratch.pool));
    expect(ownerVerdict.ok).toBe(false);
    expect(ownerVerdict.reason).toMatch(/SUPERUSER|CHỦ SỞ HỮU/);

    const appFacts = await readAppRoleFacts(app);
    expect(appFacts.currentUser).toBe('ims_app');
    expect(appFacts.isSuperuser).toBe(false);
    expect(appFacts.ownsAuditLog).toBe(false);
    expect(appRoleVerdict(appFacts)).toEqual({ ok: true, reason: null });
  });
});
