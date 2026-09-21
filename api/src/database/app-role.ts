import type { Pool } from 'pg';

/**
 * D-01: ứng dụng KHÔNG được chạy bằng superuser, cũng không bằng chủ sở hữu bảng.
 *
 * ===== VÌ SAO PHẢI KIỂM LÚC BOOT =====
 *
 * Bản vá D-01 gồm hai nửa: một migration phát quyền, và một thay đổi TRIỂN KHAI (đổi
 * `DATABASE_URL` sang role `ims_app`). Nửa thứ hai không nằm trong git của ai cả — nó nằm
 * trong file `.env` của từng nơi cài. Migration chạy xong mà `.env` chưa đổi thì mọi thứ
 * vẫn xanh, vẫn chạy, và NFR-03 vẫn sai y như trước — đúng kiểu hỏng im lặng mà rà soát
 * 19/09 gọi là "sẽ không tự rơi vào epic nào".
 *
 * Nên chính ứng dụng tự hỏi câu đó mỗi lần khởi động.
 *
 * ===== HAI CÂU HỎI, KHÔNG PHẢI MỘT =====
 *
 * `rolsuper` là câu hiển nhiên. Câu thứ hai ít hiển nhiên hơn và cũng nguy hiểm ngang:
 * CHỦ SỞ HỮU một bảng làm được `ALTER TABLE audit_log DISABLE TRIGGER ALL` — tức tháo được
 * chính cái lưới mà `0005` dựng lên — rồi `DELETE` thoải mái. Không cần superuser.
 *
 * Bỏ sót câu thứ hai thì "đã tách role" trở thành một câu nói đúng về giấy tờ mà sai về
 * thực tế: `ims_app` không phải superuser, nhưng nếu nó sở hữu bảng thì chẳng có gì đổi.
 */
export interface AppRoleFacts {
  currentUser: string;
  isSuperuser: boolean;
  ownsAuditLog: boolean;
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
        'DB. Đổi DATABASE_URL sang role ims_app (xem 0048_app_role_split.sql).',
    };
  }
  if (facts.ownsAuditLog) {
    return {
      ok: false,
      reason:
        `Ứng dụng đang kết nối DB bằng CHỦ SỞ HỮU bảng audit_log ("${facts.currentUser}"). ` +
        'Chủ sở hữu tháo được trigger append-only bằng một câu ALTER TABLE, nên REVOKE không ' +
        'còn nghĩa gì. Đổi DATABASE_URL sang role ims_app (xem 0048_app_role_split.sql).',
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
  }>(
    `SELECT current_user::text AS role_name,
            COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
              AS is_superuser,
            EXISTS (
              SELECT 1 FROM pg_class c
              JOIN pg_roles r ON r.oid = c.relowner
              WHERE c.relname = 'audit_log' AND r.rolname = current_user
            ) AS owns_audit_log`,
  );
  const row = rows[0];
  return {
    currentUser: row.role_name,
    isSuperuser: row.is_superuser === true,
    ownsAuditLog: row.owns_audit_log === true,
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
 */
export async function ensureAppRole(
  ownerPool: Pool,
  roleName: string,
  password: string,
): Promise<void> {
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
 * Nơi cài được phép chạy bằng role rộng — DANH SÁCH CHO PHÉP, không phải danh sách CẤM.
 *
 * Bản đầu (20/09) viết `if (NODE_ENV === 'production') throw`, tức một danh sách cấm gồm
 * đúng một phần tử. Mọi tên khác — `staging`, `preprod`, `uat`, hay không đặt gì — rơi vào
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
 * Nó ở `main.ts` tới 21/09, và vì thế KHÔNG bài kiểm nào chạy vào được: `main.ts` gọi
 * `bootstrap()` ngay khi nạp module, nên import nó vào một bài kiểm là dựng cả ứng dụng.
 * Đo được hậu quả: gỡ hẳn câu `throw` thì mọi cổng vẫn xanh — vì mọi lượt chạy đều ở cấu
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
