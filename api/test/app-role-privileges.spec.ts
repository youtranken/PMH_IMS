import { Pool } from 'pg';
import {
  appRoleVerdict,
  assertNarrowRole,
  ensureAppRole,
  readAppRoleFacts,
} from '../src/database/app-role';
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

  /*
   * ===== CHÍN BẢNG LỊCH SỬ, KHÔNG PHẢI MỘT =====
   *
   * `0048` phát quyền bằng `GRANT ... ON ALL TABLES` rồi REVOKE lại đúng MỘT bảng:
   * `audit_log`. Chín bảng chỉ-thêm mà `0039` liệt kê thì nhận trọn `UPDATE`/`DELETE`.
   *
   * Lập luận của chính `0048` là "trigger chưa đủ, phải có ACL" — và lập luận đó đúng y hệt
   * với chín bảng này: trigger là lớp CHỦ SỞ HỮU tháo được, ACL mới là lớp `ims_app` không
   * chạm tới. Bản vá D-01 chốt lập luận cho một bảng rồi dừng; rà soát chéo 21/09 tìm ra.
   *
   * Vì sao chốt `42501` chứ không chốt "có ném": cả chín bảng ĐỀU có trigger append-only từ
   * `0039`, nên một bài kiểu "câu lệnh này phải ném" sẽ XANH kể cả khi không có dòng REVOKE
   * nào — trigger một mình làm nó xanh, bằng `P0001`. Đúng cái bẫy mà mục 17.3 vừa ghi lại.
   */
  const APPEND_ONLY_HISTORY = [
    'catalog_history',
    'device_history',
    'software_history',
    'isp_line_history',
    'renewal_history',
    'ip_history',
    'approval_history',
    'nat_rule_history',
    'service_account_history',
  ];

  it.each(APPEND_ONLY_HISTORY)(
    '%s — chặn SỬA/XOÁ/TRUNCATE ở ACL, không chỉ ở trigger',
    async (table) => {
      // `42501` = insufficient_privilege (ACL). `P0001` = RAISE EXCEPTION trong trigger.
      // Chỉ mã đầu chứng minh hàng rào nằm ở nơi `ims_app` không gỡ được.
      expect(await sqlStateOf(app, `UPDATE ${table} SET id = id`)).toBe('42501');
      expect(await sqlStateOf(app, `DELETE FROM ${table}`)).toBe('42501');
      expect(await sqlStateOf(app, `TRUNCATE ${table}`)).toBe('42501');
    },
    TEST_TIMEOUT,
  );

  it.each(APPEND_ONLY_HISTORY)('%s — nhưng GHI THÊM thì vẫn phải chạy được', async (table) => {
    /*
     * Vế bắt buộc phải có. REVOKE tay nặng hơn cần một chút — ví dụ lỡ revoke cả `INSERT` —
     * thì mọi lượt ghi nghiệp vụ chết ở production, và bài "phải bị chặn" ở trên vẫn XANH.
     * Một hàng rào chặn nhầm việc đúng thì đắt hơn lỗ nó vá.
     */
    const { rows } = await app.query<{ ok: boolean }>(
      `SELECT has_table_privilege('ims_app', $1, 'INSERT') AS ok`,
      [table],
    );
    expect(rows[0].ok).toBe(true);
  });

  it('QUÉT ĐỘNG: không bảng `%_history` nào còn UPDATE/DELETE cho ims_app', async () => {
    /*
     * Danh sách cứng ở trên là TÀI LIỆU — đọc nó biết chín bảng nào đang được canh. Bài này
     * mới là CỔNG, và nó canh thứ danh sách cứng không canh được: bảng thứ mười.
     *
     * `ALTER DEFAULT PRIVILEGES` của `0048` cấp UPDATE/DELETE cho mọi bảng chủ sở hữu tạo về
     * sau. Nên một `*_history` mới ra đời là một bảng chỉ-thêm KHÔNG có ACL, im lặng, và
     * danh sách cứng sẽ không biết gì — người thêm bảng cũng chẳng có lý do nào để sửa nó.
     * Quét động thì ngày bảng đó vào repo cũng là ngày bài này đỏ.
     *
     * Hỏi `has_table_privilege` thay vì thử chạy câu lệnh: câu lệnh còn bị trigger chặn, mà
     * trigger chặn bằng `P0001` thì bài vẫn "thấy có lỗi" và xanh sai. Đặc quyền là thứ đang
     * hỏi, nên hỏi thẳng nó.
     */
    const { rows } = await app.query<{ table_name: string; upd: boolean; del: boolean }>(
      `SELECT c.relname AS table_name,
              has_table_privilege('ims_app', c.oid, 'UPDATE') AS upd,
              has_table_privilege('ims_app', c.oid, 'DELETE') AS del
         FROM pg_class c
         WHERE c.relnamespace = 'public'::regnamespace
           AND c.relkind = 'r'
           AND (c.relname LIKE '%\\_history' OR c.relname = 'audit_log')
         ORDER BY c.relname`,
    );

    // Tiền đề: nếu câu truy vấn không tìm thấy bảng nào thì bài dưới vô nghĩa, không phải đạt.
    expect(rows.length).toBeGreaterThanOrEqual(APPEND_ONLY_HISTORY.length + 1);

    const stillWritable = rows.filter((r) => r.upd || r.del).map((r) => r.table_name);
    expect(stillWritable).toEqual([]);
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
  /*
   * ===== CHÍNH CÁI CỔNG, KHÔNG PHẢI CHỈ CÁI PHÉP PHÁN XÉT =====
   *
   * Bài ngay trên kiểm `appRoleVerdict` — một hàm thuần. Nhưng thứ thật sự đứng giữa một nơi
   * cài sai và production là `assertNarrowRole`: nó quyết định NÉM hay chỉ ghi một dòng log.
   * Tới 21/09 không bài nào chạy vào nó, và hậu quả đo được: gỡ hẳn câu `throw` thì Jest,
   * test:db, Vitest, build và cả lượt E2E đầy đủ đều XANH — vì mọi lượt chạy đều ở cấu hình
   * ĐÚNG, nơi hàm thoát ngay ở dòng đầu.
   *
   * Một hàng rào mà không đột biến nào làm đỏ được thì chưa phải hàng rào; nó là một lời hứa.
   *
   * Vì thế hàm được tách khỏi `main.ts` sang đây: `main.ts` không import được vào bài kiểm
   * (nó tự gọi `bootstrap()` lúc nạp module).
   */
  describe('assertNarrowRole — cổng khởi động', () => {
    /** Thu lại lời cảnh báo thay vì in ra, để bài khẳng định được là CÓ kêu. */
    function spyLogger(): { warn: (m: string) => void; said: string[] } {
      const said: string[] = [];
      return { warn: (m: string) => said.push(m), said };
    }

    it('role rộng + nơi cài THẬT ⇒ NÉM, chặn hẳn lượt boot', async () => {
      await expect(assertNarrowRole(scratch.pool, spyLogger(), 'production')).rejects.toThrow(
        /SUPERUSER|CHỦ SỞ HỮU/,
      );
    });

    /*
     * Hàng đắt nhất của bảng này (R-01, chốt 21/09).
     *
     * Bản đầu viết `if (NODE_ENV === 'production') throw` — một danh sách CẤM gồm đúng một
     * phần tử. Mọi tên môi trường khác (`staging`, `preprod`, `uat`, hoặc không đặt gì) rơi
     * vào nhánh "chỉ cảnh báo", tức chạy bằng superuser mà không ai bị chặn — ở đúng những
     * nơi giống production nhất.
     *
     * Đảo thành danh sách CHO PHÉP thì môi trường mới sinh ra sau này mặc định được BẢO VỆ,
     * thay vì mặc định bỏ ngỏ. Một cái tên chưa ai nghĩ tới không nên là một lỗ hổng.
     */
    it('role rộng + tên môi trường LẠ ⇒ vẫn NÉM, vì danh sách là CHO PHÉP chứ không phải CẤM', async () => {
      for (const env of ['staging', 'preprod', 'uat', '', undefined]) {
        await expect(assertNarrowRole(scratch.pool, spyLogger(), env)).rejects.toThrow(
          /SUPERUSER|CHỦ SỞ HỮU/,
        );
      }
    });

    it('role rộng + máy dev ⇒ chỉ KÊU TO, không giết stack của người khác', async () => {
      const logger = spyLogger();
      await expect(assertNarrowRole(scratch.pool, logger, 'development')).resolves.toBeUndefined();
      // Không chặn thì tối thiểu phải nói — (Jest không nhận tham số thông điệp thứ hai).
      expect(logger.said).toHaveLength(1);
      expect(logger.said[0]).toMatch(/SUPERUSER|CHỦ SỞ HỮU/);
    });

    it('role HẸP ⇒ im lặng đi tiếp, kể cả ở production', async () => {
      const logger = spyLogger();
      await expect(assertNarrowRole(app, logger, 'production')).resolves.toBeUndefined();
      // Cấu hình đúng thì đừng làm ồn.
      expect(logger.said).toHaveLength(0);
    });
  });

});
