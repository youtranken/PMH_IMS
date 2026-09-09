import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * MÀN NHẬT KÝ PHẢI DÙNG ĐƯỢC INDEX — kiểm bằng `EXPLAIN`, không bằng niềm tin.
 *
 * ===== VÌ SAO PHẢI ĐO, KHÔNG ĐƯỢC SUY =====
 *
 * "Đã thêm index rồi" và "câu truy vấn CÓ DÙNG index đó" là hai chuyện khác nhau, và khoảng
 * cách giữa chúng là chỗ hai lỗi ở đây đã nằm suốt:
 *
 *   - `audit_log_actor_idx (actor, created_at DESC)` dựng ra đúng cho bộ lọc theo người, và
 *     bộ lọc đó viết `actor ILIKE '%x%'`. Dấu sao ở ĐẦU chuỗi làm mọi index btree vô dụng.
 *     Index tồn tại, trông hợp lý trong migration, và chưa từng được dùng một lần nào.
 *   - `nat_rule_internal_idx (internal_ip)` cũng vậy: mọi truy vấn bọc cột trong `host(...)`.
 *
 * Cả hai chỉ lộ ra qua `EXPLAIN`. Nên bài này đọc chính kế hoạch thực thi của Postgres.
 *
 * ===== VÌ SAO PHẢI ÉP `enable_seqscan = off` =====
 *
 * Trên một bảng vài chục dòng, Postgres luôn chọn quét tuần tự vì nó RẺ HƠN THẬT — và bài
 * kiểm sẽ đỏ dù index hoàn toàn đúng. Tắt seqscan là cách hỏi đúng câu cần hỏi: "có tồn tại
 * một đường đi qua index cho câu này không", tách khỏi câu "hôm nay bảng to bao nhiêu".
 * Không có mẹo này thì bài chỉ chạy được trên dữ liệu thật cỡ lớn, tức là không chạy.
 */

const TEST_TIMEOUT = 120_000;

describe('Chỉ mục của audit_log và nat_rule', () => {
  let scratch: ScratchDb;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_idx');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    // ANALYZE để bộ tối ưu có thống kê; thiếu nó thì kế hoạch là phỏng đoán trên bảng rỗng.
    await scratch.pool.query('ANALYZE audit_log, nat_rule');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  /** `SET LOCAL` chỉ sống trong một transaction, nên mỗi lượt EXPLAIN cần transaction riêng. */
  async function explain(query: string): Promise<string> {
    const client = await scratch.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${query}`);
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  it(
    'lọc theo người thực hiện (`actor ILIKE %x%`) đi qua chỉ mục trigram',
    async () => {
      const plan = await explain(`SELECT id FROM audit_log WHERE actor ILIKE '%nguyen%'`);
      expect(plan).toContain('audit_log_actor_trgm');
    },
    TEST_TIMEOUT,
  );

  it(
    'lọc theo mã đối tượng cũng vậy',
    async () => {
      const plan = await explain(`SELECT id FROM audit_log WHERE object_id ILIKE '%a1b2%'`);
      expect(plan).toContain('audit_log_object_id_trgm');
    },
    TEST_TIMEOUT,
  );

  /**
   * Ô chọn "Hành động". Câu đệ quy phải nhảy qua index; nếu ai đó đổi lại thành
   * `SELECT DISTINCT` thì kế hoạch mất hẳn `audit_log_action_idx` và bài này đỏ.
   */
  it(
    'dropdown hành động nhảy qua chỉ mục, không quét cả bảng',
    async () => {
      const plan = await explain(`
        WITH RECURSIVE walk AS (
          (SELECT action FROM audit_log ORDER BY action LIMIT 1)
          UNION ALL
          SELECT (SELECT a.action FROM audit_log a WHERE a.action > walk.action
                  ORDER BY a.action LIMIT 1)
          FROM walk WHERE walk.action IS NOT NULL
        )
        SELECT action FROM walk WHERE action IS NOT NULL ORDER BY action
      `);
      expect(plan).toContain('audit_log_action_idx');
    },
    TEST_TIMEOUT,
  );

  it(
    'sổ NAT tìm theo địa chỉ đi qua chỉ mục trên `host(internal_ip)`',
    async () => {
      const plan = await explain(
        `SELECT id FROM nat_rule WHERE host(internal_ip) = '172.16.10.5' AND voided_at IS NULL`,
      );
      expect(plan).toContain('nat_rule_internal_host_idx');
    },
    TEST_TIMEOUT,
  );

  /**
   * Vế đối chứng của cả đợt dọn: bốn chỉ mục vừa bỏ KHÔNG được lặng lẽ quay lại, và những
   * chỉ mục còn lại vẫn phải phục vụ đúng các câu chúng sinh ra cho.
   */
  it(
    'bốn chỉ mục trùng đã bị bỏ, và truy vấn của chúng vẫn có đường đi',
    async () => {
      const { rows } = await scratch.pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
      );
      const names = new Set(rows.map((r) => r.indexname));
      for (const dropped of [
        'access_list_member_idx',
        'cabinet_site_idx',
        'device_port_device_idx',
        'ip_address_subnet_idx',
        'nat_rule_internal_idx',
      ]) {
        expect(names.has(dropped)).toBe(false);
      }

      /*
       * …và mỗi cái bỏ đi phải còn một index KHÁC bắt đầu bằng ĐÚNG cột đó. Kiểm cấu trúc chứ
       * không kiểm kế hoạch: "btree nhiều cột phục vụ được truy vấn lọc theo cột đầu" là tính
       * chất của Postgres, không phải thứ cần chứng minh lại mỗi lượt chạy — và trên một bảng
       * rỗng thì `EXPLAIN` vẫn chọn seq scan dù index hoàn toàn đúng, nên đo ở đó là đo nhầm.
       */
      const defs = new Map(
        (
          await scratch.pool.query<{ indexname: string; indexdef: string }>(
            `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
          )
        ).rows.map((r) => [r.indexname, r.indexdef]),
      );
      const startsWith = (column: string) =>
        [...defs.values()].some((def) => def.includes(`(${column},`) || def.includes(`(${column})`));

      expect(startsWith('member_email')).toBe(true);
      expect(startsWith('site_id')).toBe(true);
      expect(startsWith('device_id')).toBe(true);
      expect(startsWith('subnet_id')).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    '`service_account.code` theo đúng quy ước citext như năm bảng còn lại',
    async () => {
      const { rows } = await scratch.pool.query<{ table_name: string; udt_name: string }>(
        `SELECT table_name, udt_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'code'`,
      );
      const offenders = rows.filter((r) => r.udt_name !== 'citext').map((r) => r.table_name);
      expect(offenders).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    '`file.owner_type` có CHECK — loại gõ sai không nằm im trong bảng được',
    async () => {
      // `uploaded_by` là NOT NULL có khóa ngoại, nên phải có một người thật để ràng buộc
      // owner_type mới là thứ DUY NHẤT có thể làm câu lệnh hỏng.
      const {
        rows: [user],
      } = await scratch.pool.query<{ id: string }>(
        `INSERT INTO users (email, full_name, role, password_hash)
         VALUES ('idx-test@pmh.com.vn', 'Bài kiểm chỉ mục', 'sa', 'x') RETURNING id`,
      );
      const insert = (ownerType: string) =>
        scratch.pool.query(
          `INSERT INTO file (owner_type, owner_id, original_name, stored_name, mime_type, size_bytes, uploaded_by)
           VALUES ($1, gen_random_uuid(), 'a.pdf', $2, 'application/pdf', 1, $3)`,
          [ownerType, `x-${ownerType}-${Date.now()}.pdf`, user.id],
        );

      await expect(insert('devices')).rejects.toThrow(/file_owner_type_check/);
      // Vế đối chứng: loại HỢP LỆ vẫn phải vào được — ràng buộc chặt tay là ràng buộc sẽ bị gỡ.
      await expect(insert('device')).resolves.toBeTruthy();
    },
    TEST_TIMEOUT,
  );
});
