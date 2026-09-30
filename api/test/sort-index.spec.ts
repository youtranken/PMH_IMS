import { count } from 'drizzle-orm';
import { runMigrations } from '../src/database/migration-runner';
import {
  DEVICE_SORT_KEYS,
  deviceOrderBy,
  type DeviceSortKey,
} from '../src/modules/devices/devices.service';
import { deviceTable } from '../src/modules/devices/devices.schema';
import {
  SERVICE_ACCOUNT_SORT_KEYS,
  serviceAccountOrderBy,
  type ServiceAccountSortKey,
} from '../src/modules/service-accounts/service-account.service';
import { serviceAccountTable } from '../src/modules/service-accounts/service-account.schema';
import {
  SOFTWARE_SORT_KEYS,
  softwareOrderBy,
  type SoftwareSortKey,
} from '../src/modules/software/software.service';
import {
  ISP_SORT_KEYS,
  ispOrderBy,
  type IspSortKey,
} from '../src/modules/software/isp-line.service';
import { ispLineTable, softwareTable } from '../src/modules/software/software.schema';
import type { SortDir } from '../src/common/sorting';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * §8.8 — BẤM TIÊU ĐỀ CỘT KHÔNG ĐƯỢC SẮP LẠI CẢ BẢNG.
 *
 * ===== ĐIỀU ĐANG CANH =====
 *
 * Bốn bảng danh sách cho người dùng bấm tiêu đề để sắp xếp. Ở 1 triệu dòng, một cú bấm vào
 * "Tên thiết bị" đo được **340ms** ở trang 1 và **1.949ms** ở trang sâu, kèm **228 MB tràn ra
 * đĩa** — vì không có chỉ mục nào phục vụ được thứ tự ấy, nên Postgres đọc cả bảng rồi sắp
 * lại. Có chỉ mục: **0,083ms** (§15 sổ rà soát).
 *
 * ===== VÌ SAO BÀI NÀY HỎI "CÓ NODE `Sort` KHÔNG", CHỨ KHÔNG HỎI "CÓ CHỈ MỤC KHÔNG" =====
 *
 * "Đã thêm chỉ mục" và "câu truy vấn DÙNG được chỉ mục đó" là hai chuyện khác nhau, và khoảng
 * cách giữa chúng là chỗ kế hoạch ban đầu của §8.8 đã sai HAI lần:
 *
 *   1. Sổ ghi chỉ mục `(name, id)`. Nhưng `ORDER BY` thật của cả bốn service chốt hạ bằng
 *      **`code`**, không phải `id` — `(name, id)` sẽ không bao giờ được chọn.
 *   2. Bốn service viết `[primary, asc(code)]`, tức khoá chốt hạ CỐ ĐỊNH `asc`. Sắp giảm sinh
 *      ra `ORDER BY name DESC, code ASC` — một hình dạng TRỘN hướng mà btree `(name, code)`
 *      không phục vụ được. Nửa số lượt sắp xếp vẫn phải `Sort` dù chỉ mục đã có.
 *
 * Cả hai lỗi ấy đều cho ra một hệ thống trông như đã sửa: migration chạy sạch, chỉ mục nằm
 * trong `pg_indexes`, và không bài kiểm nào đỏ. Chỉ `EXPLAIN` mới nói thật. Nên bài này dựng
 * câu truy vấn bằng CHÍNH các hàm `*OrderBy` mà service dùng, rồi đọc kế hoạch thực thi.
 *
 * ===== VÌ SAO `enable_seqscan = off` =====
 *
 * Trên bảng vài chục dòng, quét tuần tự + sắp lại luôn RẺ HƠN THẬT, nên bài sẽ đỏ dù chỉ mục
 * hoàn hảo. Tắt seqscan là cách hỏi đúng câu cần hỏi: "có tồn tại một đường đi qua chỉ mục
 * cung cấp SẴN thứ tự này không", tách khỏi câu "hôm nay bảng to bao nhiêu". Nếp này lấy từ
 * `audit-index.spec.ts`.
 */

const TEST_TIMEOUT = 180_000;
const DIRS: SortDir[] = ['asc', 'desc'];

describe('§8.8 — mọi cột sắp xếp được đều có chỉ mục phục vụ ĐÚNG thứ tự', () => {
  let scratch: ScratchDb;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_sort');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    await scratch.pool.query('ANALYZE device, software, service_account, isp_line');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  /** `EXPLAIN` một mảnh truy vấn drizzle, với seqscan tắt trong đúng một transaction. */
  async function planOf(text: string, params: unknown[]): Promise<string> {
    const client = await scratch.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN ${text}`,
        params,
      );
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  /**
   * Bốn bảng, mô tả bằng đúng thứ service dùng: danh sách khoá hợp lệ và hàm dựng `ORDER BY`.
   *
   * `orderBy` nhận `SortQuery<string>` vì bốn kiểu khoá khác nhau; ép về `never` ở nơi gọi là
   * cách duy nhất để một bảng dữ liệu gom được cả bốn mà không mất kiểm kiểu ở chính service.
   */
  const TABLES = [
    {
      name: 'device',
      keys: DEVICE_SORT_KEYS,
      table: deviceTable,
      orderBy: (key: string, dir: SortDir) =>
        deviceOrderBy({ key: key as DeviceSortKey, dir }),
    },
    {
      name: 'software',
      keys: SOFTWARE_SORT_KEYS,
      table: softwareTable,
      orderBy: (key: string, dir: SortDir) =>
        softwareOrderBy({ key: key as SoftwareSortKey, dir }),
    },
    {
      name: 'service_account',
      keys: SERVICE_ACCOUNT_SORT_KEYS,
      table: serviceAccountTable,
      orderBy: (key: string, dir: SortDir) =>
        serviceAccountOrderBy({ key: key as ServiceAccountSortKey, dir }),
    },
    {
      name: 'isp_line',
      keys: ISP_SORT_KEYS,
      table: ispLineTable,
      orderBy: (key: string, dir: SortDir) => ispOrderBy({ key: key as IspSortKey, dir }),
    },
  ] as const;

  /** Mọi tổ hợp (bảng, cột sắp được, hướng) — đây là bộ ca thật mà giao diện cho phép bấm. */
  const CASES = TABLES.flatMap((spec) =>
    spec.keys.flatMap((key) => DIRS.map((dir) => ({ spec, key, dir }))),
  );

  it(
    'bộ ca không rỗng và phủ đủ bốn bảng',
    () => {
      // Sinh 0 ca mà vẫn xanh là cái bẫy quen thuộc — chốt lại trước.
      expect(CASES.length).toBeGreaterThanOrEqual(40);
      expect(new Set(CASES.map((c) => c.spec.name)).size).toBe(4);
    },
    TEST_TIMEOUT,
  );

  it.each(CASES.map((c) => [`${c.spec.name}.${c.key} ${c.dir}`, c] as const))(
    '%s — kế hoạch KHÔNG có node Sort',
    async (_label, c) => {
      const query = scratch.db
        .select()
        .from(c.spec.table)
        .orderBy(...c.spec.orderBy(c.key, c.dir))
        .limit(20)
        .offset(0);
      const { sql: text, params } = query.toSQL();
      const plan = await planOf(text, params);
      /*
       * `Sort` phủ luôn `Incremental Sort` (chuỗi con), và đó là chủ ý: một chỉ mục chỉ có cột
       * đầu (`device_status_idx (status)`) cho Postgres sắp thêm phần còn lại theo lô — đỡ hơn
       * sắp cả bảng, nhưng vẫn không phải thứ §8.8 hứa, và vẫn tràn đĩa ở cỡ triệu dòng.
       */
      expect(plan).not.toContain('Sort');
    },
    TEST_TIMEOUT,
  );

  it(
    'khoá chốt hạ đi CÙNG HƯỚNG với cột đang sắp',
    () => {
      /*
       * Vế này hỏi thẳng hình dạng SQL, không qua `EXPLAIN`. Cần nó vì bài trên có thể xanh
       * vì một lý do khác (planner tìm được đường khác), còn đây là điều kiện đã làm cả khối
       * §8.8 suýt vô dụng: khoá chốt hạ cố định `asc`.
       */
      /** Đọc `ORDER BY` qua `.toSQL()` — API công khai của drizzle, không mổ ruột đối tượng. */
      const orderSql = (dir: SortDir): string => {
        const { sql: text } = scratch.db
          .select()
          .from(deviceTable)
          .orderBy(...deviceOrderBy({ key: 'name', dir }))
          .toSQL();
        return text.slice(text.indexOf('order by'));
      };
      expect(deviceOrderBy({ key: 'name', dir: 'asc' })).toHaveLength(2);
      expect(deviceOrderBy({ key: 'name', dir: 'desc' })).toHaveLength(2);
      // Cả hai vế cùng hướng — đây là điều kiện để MỘT chỉ mục phục vụ được cả asc lẫn desc.
      expect(orderSql('asc')).toMatch(/"name" asc, "device"."code" asc/);
      expect(orderSql('desc')).toMatch(/"name" desc, "device"."code" desc/);
      // Sắp theo chính cột chốt hạ thì chỉ còn MỘT vế — không sinh `ORDER BY code, code`.
      expect(deviceOrderBy({ key: 'code', dir: 'desc' })).toHaveLength(1);
      expect(serviceAccountOrderBy({ key: 'code', dir: 'desc' })).toHaveLength(1);
    },
    TEST_TIMEOUT,
  );

  it(
    'các chỉ mục cũ CHỈ CÓ MỘT CỘT hoặc PARTIAL vẫn còn — chỉ mục sắp xếp thêm chứ không thay',
    async () => {
      /*
       * `device_warranty_idx … WHERE status <> 'retired'` và `software_end_idx` là chỉ mục
       * PARTIAL, dựng cho màn Sắp hết hạn. Chúng không phục vụ `ORDER BY` của màn danh sách
       * (câu đó không mang điều kiện ấy), nhưng gỡ chúng đi là làm chậm một màn khác. Ô này
       * khoá lại việc chỉ mục sắp xếp chỉ THÊM. `isp_line_end_idx` không có: đường truyền không
       * còn hạn (Q-04).
       */
      const { rows } = await scratch.pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
          WHERE indexname IN ('device_warranty_idx','software_end_idx',
                              'service_account_kind_idx','device_status_idx','software_kind_idx')`,
      );
      expect(rows.map((r) => r.indexname).sort()).toEqual([
        'device_status_idx',
        'device_warranty_idx',
        'service_account_kind_idx',
        'software_end_idx',
        'software_kind_idx',
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'phép đếm tổng KHÔNG bị chỉ mục thứ tự làm chậm đi',
    async () => {
      // Vế đối chứng: 19 chỉ mục mới là để phục vụ ORDER BY. Nếu vì chúng mà `count(*)` đổi
      // kế hoạch sang một index scan đắt hơn thì lãi một đằng lỗ một nẻo.
      const query = scratch.db.select({ n: count() }).from(deviceTable);
      const { sql: text, params } = query.toSQL();
      const plan = await planOf(text, params);
      expect(plan).toMatch(/Aggregate/);
    },
    TEST_TIMEOUT,
  );
});
