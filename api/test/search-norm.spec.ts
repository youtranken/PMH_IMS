import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { count } from 'drizzle-orm';
import { foldSearch } from '../src/common/search-fold';
import { imsNormLike, searchNormLike } from '../src/common/sql';
import { runMigrations } from '../src/database/migration-runner';
import { siteTable } from '../src/modules/catalog/catalog.schema';
import { deviceTable } from '../src/modules/devices/devices.schema';
import { usersTable } from '../src/modules/users/users.schema';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * B-01 — TÌM KIẾM PHẢI KHỚP TIẾNG VIỆT KHÔNG DẤU, HỎI TRÊN POSTGRES THẬT.
 *
 * ===== VÌ SAO BÀI NÀY KHÔNG THỂ LÀ BÀI ĐƠN VỊ =====
 *
 * Toàn bộ B-01 nằm ở ba thứ mà chỉ Postgres trả lời được:
 *
 *   1. `ims_norm(text)` có gấp dấu ĐÚNG NHƯ bản JS không — `unaccent` dùng một BẢNG QUY TẮC,
 *      `stripDiacritics` dùng phân rã NFD; hai đường hoàn toàn khác nhau tình cờ cho cùng kết
 *      quả trên tiếng Việt, và "tình cờ" thì phải được canh.
 *   2. `search_norm` có phải CỘT SINH không. Nếu ai đó thay nó bằng một cột thường cộng một
 *      lượt backfill, mọi thứ vẫn xanh hôm nay và sai từ bản ghi sửa tiếp theo — thứ không
 *      bài đơn vị nào hỏi được.
 *   3. Chỉ mục GIN trigram có phục vụ ĐÚNG vế `LIKE` mà `searchNormLike` sinh ra không. "Đã
 *      thêm index" và "câu truy vấn dùng index đó" là hai chuyện khác nhau — repo này đã có
 *      hai chỉ mục sống nhiều tháng mà planner chưa chọn lần nào (`audit-index.spec.ts`).
 *
 * ===== VÌ SAO CHẠY QUA DRIZZLE CHỨ KHÔNG CHÉP SQL =====
 *
 * Vế WHERE dựng bằng chính `searchNormLike`/`imsNormLike` mà sáu service sẽ dùng. Chép tay
 * một câu SQL tương đương là để bài kiểm tự xác nhận chính nó: nó sẽ xanh kể cả khi hàm dùng
 * chung sinh ra thứ khác hẳn.
 *
 * ===== TẦNG THỨ BA CỦA BẢNG CHUẨN DÙNG CHUNG =====
 *
 * `ops/search-fold-cases.json` được đọc ở ba nơi: bài này (SQL), `api/src/common/
 * search-fold.spec.ts` (JS bên api) và `web/src/test/search-fold.test.ts` (JS bên web). Ba
 * bản cài đặt không import được nhau, nên cái giữ chúng khỏi trôi là chỗ này.
 */

interface FoldCase {
  input: string;
  fold: string;
}

const CASES_FILE = join(__dirname, '..', '..', 'ops', 'search-fold-cases.json');
const foldCases: FoldCase[] = (
  JSON.parse(readFileSync(CASES_FILE, 'utf8')) as { cases: FoldCase[] }
).cases;

const TEST_TIMEOUT = 180_000;

/** 5 bảng nghiệp vụ mang cột sinh + chỉ mục GIN. Danh mục đi đường khác — xem mô tả cuối bài. */
const INDEXED_TABLES = ['device', 'software', 'service_account', 'isp_line', 'nat_rule'] as const;

describe('B-01 — gấp dấu tiếng Việt ở tầng CSDL', () => {
  let scratch: ScratchDb;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_search');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  /** Đếm thiết bị khớp — đúng vế WHERE mà `DevicesService.buildWhere` sinh ra. */
  async function findDevices(term: string): Promise<number> {
    const rows = await scratch.db
      .select({ n: count() })
      .from(deviceTable)
      .where(searchNormLike(deviceTable, term));
    return Number(rows[0]?.n ?? 0);
  }

  describe('hàm ims_norm', () => {
    it(
      'cho KẾT QUẢ Y HỆT bản JS trên cả bảng chuẩn dùng chung',
      async () => {
        // Đọc 0 hàng mà vẫn xanh là cái bẫy quen thuộc — chốt số lượng trước.
        expect(foldCases.length).toBeGreaterThanOrEqual(15);
        const { rows } = await scratch.pool.query<{ i: number; norm: string }>(
          `SELECT ord::int AS i, ims_norm(value) AS norm
             FROM unnest($1::text[]) WITH ORDINALITY AS t(value, ord)`,
          [foldCases.map((c) => c.input)],
        );
        const bySql = new Map(rows.map((r) => [r.i, r.norm]));
        for (const [index, item] of foldCases.entries()) {
          // Ba vế phải trùng nhau: bảng chuẩn · JS · SQL.
          expect(bySql.get(index + 1)).toBe(item.fold);
          expect(foldSearch(item.input)).toBe(item.fold);
        }
      },
      TEST_TIMEOUT,
    );

    it(
      'được khai IMMUTABLE — điều kiện để cột sinh và chỉ mục tồn tại',
      async () => {
        const { rows } = await scratch.pool.query<{ provolatile: string }>(
          `SELECT provolatile FROM pg_proc WHERE proname = 'ims_norm'`,
        );
        expect(rows).toHaveLength(1);
        // `unaccent()` của contrib là STABLE ('s'); bọc lại thành IMMUTABLE ('i') là CẢ ĐIỂM
        // của hàm này — thiếu nó thì Postgres từ chối cả cột sinh lẫn chỉ mục.
        expect(rows[0].provolatile).toBe('i');
      },
      TEST_TIMEOUT,
    );
  });

  describe('cột sinh search_norm', () => {
    it.each(INDEXED_TABLES)(
      '%s.search_norm là cột SINH (stored), không phải cột thường chờ backfill',
      async (table) => {
        const { rows } = await scratch.pool.query<{ is_generated: string }>(
          `SELECT is_generated FROM information_schema.columns
            WHERE table_name = $1 AND column_name = 'search_norm'`,
          [table],
        );
        expect(rows).toHaveLength(1);
        // 'ALWAYS' = Postgres tự tính lại mỗi lượt ghi. 'NEVER' = một cột thường, và mọi hàng
        // sửa sau hôm nay sẽ mang khóa tìm kiếm CŨ mà không ai hay.
        expect(rows[0].is_generated).toBe('ALWAYS');
      },
      TEST_TIMEOUT,
    );

    it.each(INDEXED_TABLES)(
      '%s có chỉ mục GIN trigram trên search_norm',
      async (table) => {
        const { rows } = await scratch.pool.query<{ indexdef: string }>(
          `SELECT indexdef FROM pg_indexes
            WHERE tablename = $1 AND indexdef LIKE '%search_norm%'`,
          [table],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].indexdef).toContain('gin_trgm_ops');
      },
      TEST_TIMEOUT,
    );

    it(
      'không còn chỉ mục nào INVALID sau lượt CREATE INDEX CONCURRENTLY',
      async () => {
        // Lượt đầu tiên dự án dùng `ims:no-transaction` thật. CIC hỏng giữa chừng KHÔNG
        // rollback được: nó để lại một chỉ mục INVALID mà planner bỏ qua trong im lặng.
        const { rows } = await scratch.pool.query<{ idx: string }>(
          `SELECT indexrelid::regclass::text AS idx FROM pg_index WHERE NOT indisvalid`,
        );
        expect(rows.map((r) => r.idx)).toEqual([]);
      },
      TEST_TIMEOUT,
    );
  });

  describe('thiết bị — đúng kịch bản đo được ở §13.3', () => {
    beforeAll(async () => {
      const { rows } = await scratch.pool.query<{ id: string }>(
        `INSERT INTO device_type (name) VALUES ('Máy trạm') RETURNING id`,
      );
      await scratch.pool.query(
        `INSERT INTO device (code, name, device_type_id, model, serial, status)
         VALUES ('DM-KT-001', 'Máy trạm kế toán', $1, 'Optiplex 7090', 'SN-ĐỎ-01', 'in_use')`,
        [rows[0].id],
      );
    }, TEST_TIMEOUT);

    it(
      'gõ KHÔNG DẤU tìm thấy hàng CÓ DẤU — chính lỗi B-01',
      async () => {
        expect(await findDevices('may tram')).toBe(1);
        expect(await findDevices('ke toan')).toBe(1);
      },
      TEST_TIMEOUT,
    );

    it(
      'gõ CÓ DẤU vẫn tìm thấy — chữa bệnh này không được làm mắc bệnh ngược lại',
      async () => {
        expect(await findDevices('Máy trạm')).toBe(1);
        expect(await findDevices('kế toán')).toBe(1);
      },
      TEST_TIMEOUT,
    );

    it(
      'tìm được qua mã, model và serial — bốn cột cũ đều còn trong khóa tìm kiếm',
      async () => {
        expect(await findDevices('DM-KT')).toBe(1);
        expect(await findDevices('optiplex')).toBe(1);
        expect(await findDevices('sn-do-01')).toBe(1);
      },
      TEST_TIMEOUT,
    );

    it(
      'tìm được qua người sử dụng và bộ phận — "máy của chị Bình đâu?" (Q-14)',
      async () => {
        await scratch.pool.query(
          `UPDATE device SET assigned_to = 'Chị Bình', department = 'Phòng Kế hoạch'
            WHERE code = 'DM-KT-001'`,
        );
        expect(await findDevices('chi binh')).toBe(1);
        expect(await findDevices('ke hoach')).toBe(1);
        // Cột sinh: đổi người dùng thì khóa tìm kiếm đi theo, người cũ không còn khớp.
        await scratch.pool.query(
          `UPDATE device SET assigned_to = NULL, department = NULL WHERE code = 'DM-KT-001'`,
        );
        expect(await findDevices('chi binh')).toBe(0);
      },
      TEST_TIMEOUT,
    );

    it(
      'không khớp bừa',
      async () => {
        expect(await findDevices('may chu')).toBe(0);
      },
      TEST_TIMEOUT,
    );

    it(
      'ĐỔI TÊN thì khóa tìm kiếm đi theo ngay — bằng chứng cột SINH chứ không phải backfill',
      async () => {
        await scratch.pool.query(
          `UPDATE device SET name = 'Bộ phát sóng tầng hầm' WHERE code = 'DM-KT-001'`,
        );
        expect(await findDevices('phat song')).toBe(1);
        expect(await findDevices('may tram')).toBe(0);
        await scratch.pool.query(
          `UPDATE device SET name = 'Máy trạm kế toán' WHERE code = 'DM-KT-001'`,
        );
        expect(await findDevices('may tram')).toBe(1);
      },
      TEST_TIMEOUT,
    );

    it(
      'ký tự đại diện của LIKE vẫn được thoát — gấp dấu KHÔNG nuốt mất escapeLike',
      async () => {
        // '%' trần sẽ khớp mọi hàng. Thoát đúng thì nó là một ký tự phần trăm bình thường,
        // và không hàng nào chứa nó.
        expect(await findDevices('%')).toBe(0);
        expect(await findDevices('_')).toBe(0);
      },
      TEST_TIMEOUT,
    );

    it(
      'kế hoạch thực thi ĐI QUA chỉ mục trigram, không quét tuần tự',
      async () => {
        const client = await scratch.pool.connect();
        try {
          await client.query('BEGIN');
          // Trên bảng một dòng, quét tuần tự RẺ HƠN THẬT. Tắt nó là cách hỏi đúng câu: "có
          // tồn tại đường đi qua chỉ mục cho vế này không" (nếp của `audit-index.spec.ts`).
          await client.query('SET LOCAL enable_seqscan = off');
          const { rows } = await client.query<{ 'QUERY PLAN': string }>(
            `EXPLAIN SELECT id FROM device WHERE search_norm LIKE ims_norm($1)`,
            ['%may tram%'],
          );
          const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
          // Tham số ràng buộc, KHÔNG phải hằng — đúng hình dạng drizzle gửi đi. Nếu trigram
          // chỉ phục vụ được hằng số thì chỉ mục này vô dụng trong sản phẩm thật.
          expect(plan).toContain('device_search_norm_trgm');
        } finally {
          await client.query('ROLLBACK').catch(() => undefined);
          client.release();
        }
      },
      TEST_TIMEOUT,
    );
  });

  describe('danh mục — gấp dấu KHÔNG cần cột sinh', () => {
    it(
      'tìm được tên site không dấu qua ims_norm tính tại chỗ',
      async () => {
        await scratch.pool.query(`INSERT INTO site (code, name) VALUES ('HN-TRS', 'Trụ sở Hà Nội')`);
        const rows = await scratch.db
          .select({ n: count() })
          .from(siteTable)
          .where(imsNormLike(siteTable.name, 'tru so'));
        expect(Number(rows[0]?.n ?? 0)).toBe(1);
      },
      TEST_TIMEOUT,
    );

    it(
      'tìm được HỌ TÊN nhân sự không dấu — `users` cũng đi đường tính tại chỗ',
      async () => {
        /*
         * `users` đứng ngoài đợt dựng cột sinh vì nó luôn dưới vài trăm dòng. Nhưng "không
         * cần chỉ mục" KHÁC "không cần gấp dấu", và `full_name` là họ tên tiếng Việt — đúng
         * chỗ dấu làm hỏng việc tìm nhất. Kế hoạch ban đầu của sổ rà soát gộp nhầm hai điều
         * ấy; ô này khoá lại phần đã tách ra.
         */
        await scratch.pool.query(
          `INSERT INTO users (email, full_name, role, password_hash)
           VALUES ('nth@pmh.com.vn', 'Nguyễn Thị Hồng Ánh', 'member', 'x')`,
        );
        const rows = await scratch.db
          .select({ n: count() })
          .from(usersTable)
          .where(imsNormLike(usersTable.fullName, 'nguyen thi'));
        expect(Number(rows[0]?.n ?? 0)).toBe(1);
      },
      TEST_TIMEOUT,
    );

    it(
      'các bảng danh mục CỐ Ý không có cột sinh — đây là kết luận, không phải bỏ sót',
      async () => {
        // Vài chục tới vài trăm dòng. Cột sinh + chỉ mục GIN cho mỗi bảng là trả giá lưu trữ
        // và giá ghi mà không mua được gì. Ô này khoá lại quyết định ấy để lượt rà soát sau
        // không báo nó lại như một thiếu sót. `users` và `audit_log` cũng cố ý ngoài phạm vi:
        // `users` luôn dưới vài trăm dòng, `audit_log.actor` là email nên không có dấu.
        const { rows } = await scratch.pool.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.columns
            WHERE column_name = 'search_norm'
              AND table_name IN ('site','cabinet','device_type','vendor','department',
                                 'isp_provider','service_port','users','audit_log')`,
        );
        expect(rows.map((r) => r.table_name)).toEqual([]);
      },
      TEST_TIMEOUT,
    );
  });
});
