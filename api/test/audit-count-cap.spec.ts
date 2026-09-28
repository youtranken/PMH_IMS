import { Pool } from 'pg';
import { runMigrations } from '../src/database/migration-runner';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { AuditQueryService } from '../src/modules/audit/audit-query.service';
import { AuditObjectLabelRegistry } from '../src/common/audit-object-labels.registry';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * ĐẾM NHẬT KÝ AN NINH PHẢI CÓ TRẦN.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `GET /admin/audit` chạy `SELECT count(*) FROM audit_log <where>` cho MỖI lần bấm sang trang.
 * Mở màn lần đầu thì `<where>` rỗng, tức quét trọn bảng.
 *
 * `audit_log` là bảng CHỈ-THÊM giữ VĨNH VIỄN (NFR-03): nó chỉ có thể to lên. Nên cái giá này
 * không đứng yên — nó lớn lên mỗi ngày, mãi mãi. Đây là loại chậm không ai để ý lúc viết (bảng
 * đang có 200 dòng) và không ai gỡ nổi sau hai năm chạy, vì lúc đó sửa nó là sửa cái màn mà
 * auditor đang dùng.
 *
 * ===== VÌ SAO Ở TẦNG NÀY =====
 *
 * Câu hỏi là "Postgres có DỪNG LẠI không", và chỉ Postgres trả lời được. Bài dưới hỏi bằng
 * `EXPLAIN ANALYZE` và đọc số dòng THẬT SỰ đã đi qua — không phải đo thời gian (đo thời gian
 * trên máy đang tải là đo tiếng ồn).
 */

const TEST_TIMEOUT = 180_000;
const COUNT_CAP = 10_000;
const SEEDED = 12_000;

describe('Đếm nhật ký an ninh có trần', () => {
  let scratch: ScratchDb;
  let pool: Pool;
  let service: AuditQueryService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_audit_cap');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    pool = scratch.pool;
    /*
     * `UsersApiService` THẬT, chạy trên chính scratch DB — không phải bản giả.
     *
     * Từ 21/09 viewer audit tra tên người thao tác qua cửa này thay vì `LEFT JOIN users`
     * (A-07). Cắm một bản giả trả map rỗng thì bài kiểm bên dưới vẫn xanh trong khi đường
     * tra tên hỏng hoàn toàn — mà đó đúng là thứ vừa được thay.
     */
    service = new AuditQueryService(
      scratch.db,
      new UsersApiService(new UsersService(scratch.db)),
      new SystemConfigService(scratch.db),
      new AuditObjectLabelRegistry(),
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  /**
   * CHỈ CỘNG THÊM, không bao giờ dọn.
   *
   * Thử `DELETE` rồi `TRUNCATE` giữa các bài đều bị chặn — `audit_log` có trigger chặn cả hai
   * (0005), đúng như NFR-03/AD-13 muốn. Hàng rào đó không phải thứ bài kiểm được tắt đi cho
   * tiện, nên các bài dưới xếp theo thứ tự TĂNG DẦN số dòng và mỗi bài cộng thêm vào cái bài
   * trước để lại. Đọc hơi lạ, nhưng nó phản ánh đúng bản chất bảng này: nhật ký chỉ lớn lên.
   */
  async function addRows(rows: number, action = 'test.seeded') {
    await pool.query(
      `INSERT INTO audit_log (actor, action, object_type, object_id)
       SELECT 'ai-do@pmh.com.vn', $2, 'device', g::text
       FROM generate_series(1, $1) g`,
      [rows, action],
    );
  }

  it(
    'VẾ ĐỐI CHỨNG (chạy TRƯỚC, lúc bảng còn nhỏ): dưới trần phải là con số THẬT',
    async () => {
      await addRows(37);
      const page = await service.listAudit({ page: 1, pageSize: 20 });

      expect(page.total).toBe(37);
      expect(page.totalCapped).toBe(false);
    },
    TEST_TIMEOUT,
  );

  it(
    'nhiều hơn trần → trả đúng trần và NÓI RA rằng nó bị cắt',
    async () => {
      await addRows(SEEDED);
      const page = await service.listAudit({ page: 1, pageSize: 20 });

      expect(page.total).toBe(COUNT_CAP);
      /*
       * Cờ này là phần không được bỏ. Một con số bị cắt mà trông như số thật thì tệ hơn hẳn
       * một con số thành thật rằng nó bị cắt — nhật ký an ninh là chỗ người ta đếm để đối
       * chiếu, và "10.000" đọc như một sự thật.
       */
      expect(page.totalCapped).toBe(true);
      expect(page.items).toHaveLength(20);
    },
    TEST_TIMEOUT,
  );

  it(
    'lọc vẫn đúng: trần không được làm hỏng con số của một bộ lọc hẹp',
    async () => {
      await addRows(1, 'test.rieng');
      const page = await service.listAudit({ page: 1, pageSize: 20, action: 'test.rieng' });

      expect(page.total).toBe(1);
      expect(page.totalCapped).toBe(false);
    },
    TEST_TIMEOUT,
  );

  it(
    'ĐO THẬT: câu mới DỪNG ở trần, câu cũ đi hết bảng',
    async () => {
      const rowsGoneThrough = async (query: string): Promise<number> => {
        const { rows } = await pool.query<{ 'QUERY PLAN': unknown }>(
          `EXPLAIN (ANALYZE, FORMAT JSON) ${query}`,
        );
        const plan = (rows[0]['QUERY PLAN'] as { Plan: PlanNode }[])[0].Plan;
        return maxActualRows(plan);
      };

      const old = await rowsGoneThrough('SELECT count(*)::int FROM audit_log a');
      const capped = await rowsGoneThrough(
        `SELECT count(*)::int FROM (SELECT 1 FROM audit_log a LIMIT ${COUNT_CAP + 1}) capped`,
      );

      /*
       * Câu cũ phải đi qua TOÀN BỘ bảng — đây là vế chứng minh bài này đo đúng thứ cần đo.
       * Không có nó thì một câu mới "cũng quét hết" vẫn xanh, vì không có gì để so.
       */
      expect(old).toBeGreaterThanOrEqual(SEEDED);
      // Còn câu mới thì dừng ngay khi gom đủ, bất kể bảng to tới đâu.
      expect(capped).toBeLessThanOrEqual(COUNT_CAP + 1);
    },
    TEST_TIMEOUT,
  );

  /**
   * VẾ THAY CHO `LEFT JOIN users` (A-07, vá 21/09).
   *
   * Gỡ một câu JOIN mà không có bài nào hỏi "tên còn hiện ra không" thì bản vá AD-2 đổi một
   * lỗi kiến trúc lấy một lỗi hiển thị — và lỗi hiển thị ấy im lặng: cột Người thao tác chỉ
   * trống đi, không ai 500, không gì đỏ.
   */
  describe('tên người thao tác, tra qua cửa chính thay vì JOIN', () => {
    it(
      'hiện tên của người có trong sổ, và `null` cho actor không phải người dùng',
      async () => {
        await pool.query(
          `INSERT INTO users (email, full_name, role, password_hash)
           VALUES ('nguoi.that@pmh.com.vn', 'Nguyễn Văn Thật', 'admin', 'x')`,
        );
        await addRows(1, 'test.actor-name');
        await pool.query(
          `INSERT INTO audit_log (actor, action, object_type, object_id)
           VALUES ('nguoi.that@pmh.com.vn', 'test.actor-name', 'device', 'co-ten'),
                  ('system', 'test.actor-name', 'device', 'khong-ten')`,
        );

        const page = await service.listAudit({
          action: 'test.actor-name',
          page: 1,
          pageSize: 50,
        });
        const byObject = new Map(page.items.map((row) => [row.objectId, row.actorName]));
        expect(byObject.get('co-ten')).toBe('Nguyễn Văn Thật');
        // Job nền không phải một người trong sổ — `null` là câu trả lời đúng, không phải thiếu.
        expect(byObject.get('khong-ten')).toBeNull();
      },
      TEST_TIMEOUT,
    );

    /**
     * HAI CHIỀU, VÀ CHIỀU THỨ HAI MỚI LÀ CHIỀU CÓ RĂNG.
     *
     * Bản đầu của bài này chỉ có chiều "sổ lưu chữ thường, nhật ký ghi chữ hoa" — và nó XANH
     * cả khi gỡ `.toLowerCase()` khỏi khóa map. Lý do: khóa map lúc ấy là `row.email`, tức
     * chuỗi ĐANG LƯU, vốn đã chữ thường; còn vế tra thì `r.actor.toLowerCase()` cũng ra chữ
     * thường. Hai vế gặp nhau, bẫy không bung.
     *
     * Bẫy thật nằm ở chiều ngược lại: `users.email` là `citext` nên nó CHẤP NHẬN lưu
     * `Sep@PMH.com.vn` nguyên dạng, và `WHERE email IN (...)` vẫn khớp. Lúc đó khóa map là
     * chuỗi có chữ hoa, tra bằng chuỗi đã hạ thì hụt — và cột Người thao tác trống đi, im
     * lặng, không ai 500.
     *
     * Đã gieo đột biến (bỏ `.toLowerCase()`) để kiểm: ca dưới ĐỎ, ca trên vẫn xanh.
     */
    it.each([
      ['hoa.thuong@pmh.com.vn', 'Hoa.Thuong@PMH.com.vn', 'sổ thường, nhật ký hoa'],
      ['Chu.Hoa@PMH.com.vn', 'chu.hoa@pmh.com.vn', 'sổ HOA, nhật ký thường — chiều có răng'],
    ])(
      'citext: lưu %p, nhật ký ghi %p → vẫn ra tên (%s)',
      async (stored, logged) => {
        await pool.query(
          `INSERT INTO users (email, full_name, role, password_hash)
           VALUES ($1, 'Lê Thị Hoa', 'member', 'x')`,
          [stored],
        );
        await pool.query(
          `INSERT INTO audit_log (actor, action, object_type, object_id)
           VALUES ($1, $2, 'device', 'ca-citext')`,
          [logged, `test.citext.${stored}`],
        );
        const page = await service.listAudit({
          action: `test.citext.${stored}`,
          page: 1,
          pageSize: 50,
        });
        expect(page.items[0]?.actorName).toBe('Lê Thị Hoa');
      },
      TEST_TIMEOUT,
    );
  });
});

interface PlanNode {
  'Actual Rows': number;
  Plans?: PlanNode[];
}

/** Số dòng THẬT SỰ đi qua ở nút nặng nhất của kế hoạch. */
function maxActualRows(node: PlanNode): number {
  const children = node.Plans ?? [];
  return Math.max(node['Actual Rows'] ?? 0, ...children.map(maxActualRows), 0);
}
