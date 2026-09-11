import { Pool } from 'pg';
import { runMigrations } from '../src/database/migration-runner';
import { AuditQueryService } from '../src/modules/audit/audit-query.service';
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
    service = new AuditQueryService(scratch.db);
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
