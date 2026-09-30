import { Pool } from 'pg';

/**
 * D-01: ứng dụng KHÔNG được chạy bằng superuser, cũng không bằng chủ sở hữu bảng.
 *
 * ===== VÌ SAO PHẢI KIỂM LÚC BOOT =====
 *
 * Bản vá D-01 gồm hai nửa: một migration phát quyền, và một thay đổi TRIỂN KHAI (đổi
 * `DATABASE_URL` sang role `ims_app`). Nửa thứ hai không nằm trong git của ai cả — nó nằm
 * trong file `.env` của từng nơi cài. Migration chạy xong mà `.env` chưa đổi thì mọi thứ
 * vẫn xanh, vẫn chạy, và NFR-03 vẫn sai y như trước — đúng kiểu hỏng im lặng không tự rơi
 * vào epic nào.
 *
 * Nên chính ứng dụng tự hỏi câu đó mỗi lần khởi động.
 *
 * ===== HAI CÂU HỎI, KHÔNG PHẢI MỘT =====
 *
 * `rolsuper` là câu hiển nhiên. Câu thứ hai ít hiển nhiên hơn và cũng nguy hiểm ngang:
 * CHỦ SỞ HỮU một bảng làm được `ALTER TABLE audit_log DISABLE TRIGGER ALL` — tức tháo được
 * chính cái lưới trigger chỉ-thêm — rồi `DELETE` thoải mái. Không cần superuser.
 *
 * Bỏ sót câu thứ hai thì "đã tách role" trở thành một câu nói đúng về giấy tờ mà sai về
 * thực tế: `ims_app` không phải superuser, nhưng nếu nó sở hữu bảng thì chẳng có gì đổi.
 *
 * ===== CÂU THỨ BA: THỪA KẾ VAI =====
 *
 * Hai câu trên đều hỏi về CHÍNH role đang kết nối. Postgres còn một đường thứ ba tới đúng
 * quyền ấy, và nó chỉ dài một dòng:
 *
 *     GRANT ims TO ims_app;
 *
 * Sau câu đó `ims_app` vẫn `rolsuper = false`, vẫn KHÔNG phải `relowner` của `audit_log` —
 * nên cổng hai câu vẫn ĐẬU. Nhưng nó đã là thành viên của chủ sở hữu, tức làm được
 * `ALTER TABLE audit_log DISABLE TRIGGER ALL` rồi `DELETE` thoải mái.
 *
 * Hỏi bằng `pg_has_role(..., 'MEMBER')` chứ không phải `'USAGE'`: một thành viên `NOINHERIT`
 * không tự động có quyền, nhưng `SET ROLE ims` một câu là có — `USAGE` bỏ lọt đúng ca đó.
 *
 * ===== VÀ BẢNG PHẢI ĐƯỢC CHỈ ĐÍCH DANH =====
 *
 * Câu hỏi thứ hai từng lọc bằng `relname = 'audit_log'`, không khoá schema lẫn `relkind`. Một
 * bảng hay view CÙNG TÊN ở schema khác, do `ims_app` sở hữu, làm cổng TRƯỢT OAN — chặn một
 * nơi cài đang đúng, và câu lỗi chỉ người ta đi sửa một thứ không hỏng. `to_regclass` giải
 * đúng một quan hệ theo `search_path` đã ghi rõ.
 */
export interface AppRoleFacts {
  currentUser: string;
  isSuperuser: boolean;
  ownsAuditLog: boolean;
  /** Có là THÀNH VIÊN của role sở hữu `audit_log` không — đường thứ ba, xem chú thích dưới. */
  inheritsOwner: boolean;
}

export interface AppRoleVerdict {
  ok: boolean;
  /** Câu tiếng Việt nói rõ cái gì hở, hoặc `null` khi không có gì hở. */
  reason: string | null;
}

export function appRoleVerdict(facts: AppRoleFacts): AppRoleVerdict {
  if (facts.isSuperuser) {
    return {
      ok: false,
      reason:
        `Ứng dụng đang kết nối DB bằng SUPERUSER "${facts.currentUser}". Superuser bỏ qua ` +
        'toàn bộ phân quyền, nên sổ nhật ký chỉ-thêm (NFR-03) không có hàng rào nào ở tầng ' +
        'DB. Đổi DATABASE_URL sang role ims_app (xem 0001_app_role.sql).',
    };
  }
  if (facts.ownsAuditLog) {
    return {
      ok: false,
      reason:
        `Ứng dụng đang kết nối DB bằng CHỦ SỞ HỮU bảng audit_log ("${facts.currentUser}"). ` +
        'Chủ sở hữu tháo được trigger append-only bằng một câu ALTER TABLE, nên REVOKE không ' +
        'còn nghĩa gì. Đổi DATABASE_URL sang role ims_app (xem 0001_app_role.sql).',
    };
  }
  if (facts.inheritsOwner) {
    return {
      ok: false,
      reason:
        `Role "${facts.currentUser}" là THÀNH VIÊN của role sở hữu bảng audit_log. Nó không ` +
        'sở hữu bảng, nhưng một câu SET ROLE là có trọn quyền chủ sở hữu — tháo được trigger ' +
        'append-only, và REVOKE không còn nghĩa gì. Gỡ bằng: REVOKE <chủ sở hữu> FROM ' +
        `${facts.currentUser}; (xem 0001_app_role.sql).`,
    };
  }
  return { ok: true, reason: null };
}

/** Hỏi DB ba dữ kiện trên. Tách khỏi phép phán xét để phép ấy test được bằng bảng. */
export async function readAppRoleFacts(pool: Pool): Promise<AppRoleFacts> {
  const { rows } = await pool.query<{
    role_name: string;
    is_superuser: boolean;
    owns_audit_log: boolean;
    inherits_owner: boolean;
  }>(
    `SELECT current_user::text AS role_name,
            COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
              AS is_superuser,
            EXISTS (
              SELECT 1 FROM pg_class c
              JOIN pg_roles r ON r.oid = c.relowner
              WHERE c.oid = to_regclass('public.audit_log')
                AND r.rolname = current_user
            ) AS owns_audit_log,
            EXISTS (
              SELECT 1 FROM pg_class c
              JOIN pg_roles r ON r.oid = c.relowner
              WHERE c.oid = to_regclass('public.audit_log')
                AND r.rolname <> current_user
                AND pg_has_role(current_user, r.oid, 'MEMBER')
            ) AS inherits_owner`,
  );
  const row = rows[0];
  return {
    currentUser: row.role_name,
    isSuperuser: row.is_superuser === true,
    ownsAuditLog: row.owns_audit_log === true,
    inheritsOwner: row.inherits_owner === true,
  };
}

/**
 * Đặt mật khẩu đăng nhập cho `ims_app` — chạy bằng kết nối CHỦ SỞ HỮU, trước migration.
 *
 * Vì sao ở đây chứ không trong file migration: mật khẩu là bí mật của từng nơi cài, còn
 * migration đi vào git. Và vì sao tự động chứ không để thành một bước tay: một bước tay mà
 * quên thì API không kết nối nổi, ở đúng lần triển khai đầu tiên sau khi tách role.
 *
 * Idempotent — chạy lại mỗi lần boot, và đó là tính năng: đổi mật khẩu trong `.env` rồi khởi
 * động lại là đủ, không cần nhớ một câu `psql` nào.
 *
 * ===== NHƯNG CHỈ ĐẶT LẠI KHI NÓ THẬT SỰ ĐỔI =====
 *
 * `ALTER ROLE … PASSWORD` không bind tham số được, nên mật khẩu nằm trong VĂN BẢN câu lệnh.
 * Với `log_statement = ddl` — một cấu hình rất thường gặp ở nơi cài cẩn thận — câu ấy vào log
 * máy chủ dạng rõ, mỗi lần khởi động một dòng, giữ theo chính sách log.
 *
 * Nghịch lý đáng nói ra: càng bật log kỹ để soi DDL thì càng lưu nhiều mật khẩu.
 *
 * Nên hỏi trước bằng câu hỏi thẳng nhất: THỬ ĐĂNG NHẬP. Đăng nhập được nghĩa là mật khẩu
 * trong `.env` đúng bằng thứ DB đang giữ, và không có gì để đặt lại.
 *
 * Không đọc `pg_authid` để so verifier: bảng đó chỉ superuser đọc được, mà chủ sở hữu ở một
 * nơi cài làm đúng thì KHÔNG phải superuser — phép kiểm sẽ hỏng ở đúng nơi nó cần chạy nhất.
 * Một lượt kết nối thử thì không cần quyền gì.
 *
 * Lỗi KHÔNG phải sai mật khẩu (DB chưa sẵn sàng, mạng chập) cũng rơi vào nhánh đặt lại — thà
 * chạy thừa một câu ALTER còn hơn bỏ qua rồi để api không kết nối nổi.
 */
export async function ensureAppRole(
  ownerPool: Pool,
  roleName: string,
  password: string,
  appUrl?: string,
): Promise<void> {
  if (appUrl && (await canLogIn(appUrl, roleName, password))) return;
  const client = await ownerPool.connect();
  try {
    /*
     * `CREATE ROLE`/`ALTER ROLE` không nhận tham số bind — tên role và mật khẩu phải đi thẳng
     * vào câu lệnh. Nên để CHÍNH POSTGRES trích dẫn chúng (`quote_ident`/`quote_literal`) rồi
     * mới ghép: nối chuỗi tay ở tầng JS là chỗ mà một mật khẩu chứa dấu nháy biến thành một
     * câu lệnh khác.
     */
    const quoted = await client.query<{ ident: string; lit: string }>(
      'SELECT quote_ident($1) AS ident, quote_literal($2) AS lit',
      [roleName, password],
    );
    const { ident, lit } = quoted.rows[0];

    const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE ROLE ${ident} NOLOGIN`);
    }
    await client.query(`ALTER ROLE ${ident} LOGIN PASSWORD ${lit}`);
  } finally {
    client.release();
  }
}

/**
 * Role này đăng nhập được bằng chuỗi kết nối kia không — một lượt thử, rồi đóng.
 *
 * `max: 1` và timeout ngắn: đây là một câu hỏi lúc boot, không phải một pool để dùng. Nuốt
 * MỌI lỗi thành `false` — nơi gọi chỉ cần biết "có chắc chắn đăng nhập được không", và câu
 * trả lời an toàn khi không chắc là "không", vì nó dẫn tới việc đặt lại mật khẩu.
 */
async function canLogIn(appUrl: string, roleName: string, password: string): Promise<boolean> {
  /*
   * DÙNG MẬT KHẨU SẮP ĐẶT, không dùng cái đang nằm trong `appUrl`.
   *
   * Bản đầu của bản vá này nối thẳng `appUrl` vào probe, nên nó hỏi nhầm câu: "mật khẩu CŨ
   * còn đăng nhập được không". Đăng nhập được thì nó bỏ qua — kể cả khi `.env` vừa khai một
   * mật khẩu MỚI. Tức là đổi mật khẩu trong `.env` rồi khởi động lại sẽ không có tác dụng gì,
   * im lặng, và đó đúng là tính năng mà chú thích ngay trên hàm này hứa.
   *
   * Vế đối chứng của bài kiểm bắt được — nó tồn tại chính để bản vá không tắt hẳn phép đặt lại.
   *
   * `appUrl` vì thế chỉ còn góp host/port/database; danh tính thì lấy từ tham số.
   */
  let dsn: URL;
  try {
    dsn = new URL(appUrl);
  } catch {
    // DSN không phân giải được thì thôi không đoán — cứ đặt lại mật khẩu như bản cũ vẫn làm.
    return false;
  }
  dsn.username = encodeURIComponent(roleName);
  dsn.password = encodeURIComponent(password);
  const probe = new Pool({
    connectionString: dsn.toString(),
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  probe.on('error', () => undefined);
  try {
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

/**
 * Nơi cài được phép chạy bằng role rộng — DANH SÁCH CHO PHÉP, không phải danh sách CẤM.
 *
 * Viết `if (NODE_ENV === 'production') throw` là một danh sách cấm gồm đúng một phần tử.
 * Mọi tên khác — `staging`, `preprod`, `uat`, hay không đặt gì — rơi vào
 * nhánh "chỉ cảnh báo", nghĩa là chạy bằng superuser mà không ai bị chặn, ở đúng những nơi
 * giống production nhất và cũng hay bị quên `.env` nhất.
 *
 * Đảo lại thì một cái tên môi trường chưa ai nghĩ tới mặc định được BẢO VỆ thay vì mặc định
 * bỏ ngỏ. Cái giá phải trả là thật và cố ý chấp nhận: một nơi cài có `.env` cũ sẽ CHẾT lúc
 * boot thay vì chạy tiếp. Đó là điều mong muốn — nó chết kèm một câu nói đúng chỗ hỏng, thay
 * vì chạy ba tháng rồi mới lộ ra là AD-9 chưa từng đúng.
 */
const ENVS_ALLOWED_TO_RUN_WIDE = new Set(['development', 'test']);

/**
 * Hỏi bằng chính kết nối mà ứng dụng sẽ dùng cả đời: role này có rộng quá không (D-01).
 *
 * ===== VÌ SAO HÀM NÀY NẰM Ở ĐÂY CHỨ KHÔNG Ở `main.ts` =====
 *
 * Ở `main.ts` thì KHÔNG bài kiểm nào chạy vào được: `main.ts` gọi `bootstrap()` ngay khi
 * nạp module, nên import nó vào một bài kiểm là dựng cả ứng dụng. Đo được hậu quả khi nó
 * còn ở đó: gỡ hẳn câu `throw` thì mọi cổng vẫn xanh — vì mọi lượt chạy đều ở cấu
 * hình ĐÚNG, nơi hàm thoát ngay dòng đầu. Một hàng rào không đột biến nào làm đỏ được thì
 * chưa phải hàng rào.
 *
 * `nodeEnv` là THAM SỐ BẮT BUỘC, không có giá trị mặc định và không đọc thẳng `process.env`.
 * Hai lý do, lý do thứ hai chỉ lộ ra khi bài kiểm đỏ:
 *
 *  1. Bài kiểm phải đặt được nó mà không vặn biến môi trường toàn cục — thứ rò sang bài khác.
 *  2. Với `nodeEnv = process.env.NODE_ENV` làm mặc định thì truyền `undefined` TƯỜNG MINH
 *     vẫn rơi về giá trị mặc định (đó là ngữ nghĩa của tham số mặc định trong JS). Nghĩa là
 *     ca "nơi cài không đặt NODE_ENV" — ca đáng lo NHẤT, vì nó mặc định thành `''` và phải
 *     bị chặn — trở thành ca KHÔNG diễn đạt được. Bỏ mặc định đi thì nó diễn đạt được.
 */
export async function assertNarrowRole(
  pool: Pool,
  logger: { warn: (message: string) => void },
  nodeEnv: string | undefined,
): Promise<void> {
  const verdict = appRoleVerdict(await readAppRoleFacts(pool));
  if (verdict.ok || verdict.reason === null) return;
  if (!ENVS_ALLOWED_TO_RUN_WIDE.has(nodeEnv ?? '')) {
    throw new Error(verdict.reason);
  }
  logger.warn(verdict.reason);
}
