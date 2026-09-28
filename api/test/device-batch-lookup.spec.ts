import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../src/database/migration-runner';
import type { Database } from '../src/database/database.module';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { DevicesService } from '../src/modules/devices/devices.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { createScratchDb, migrationsDir, testDbUrl, type ScratchDb } from './db';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';

/**
 * TRA THIẾT BỊ CHO MỘT DANH SÁCH PHẢI LÀ MỘT LƯỢT, KHÔNG PHẢI MỖI DÒNG MỘT LƯỢT.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `DevicesApiService.getById` trông như một truy vấn và KHÔNG phải: nó đọc hàng `device` rồi
 * gọi `decorate`, mà hàm đó gọi `catalog.lists()` — bảy câu SELECT song song, không cache.
 * Tám truy vấn cho một thiết bị.
 *
 * Con số đó vô hại khi mở một hồ sơ. Nó thành tai hại ở bốn chỗ gọi nó TRONG VÒNG LẶP:
 * màn dải IP, sổ NAT, danh sách đường truyền, bảng gán license. Một dải /24 gán đầy là
 * 254 × 8 ≈ 2000 truy vấn cho MỘT lần mở màn — và nó lớn lên theo đúng chiều mà sổ IPAM sẽ
 * lớn lên.
 *
 * Chú thích ở `LicenseAssignmentService.decorate` còn ghi thẳng "(một lượt hỏi devices.api,
 * không N+1)" trong khi code ngay dưới gọi `getById` cho từng dòng. Dòng chữ đó chính là lý
 * do không ai đi kiểm lại.
 *
 * ===== VÌ SAO Ở TẦNG NÀY =====
 *
 * Thứ cần đo là SỐ TRUY VẤN, và chỉ đếm được khi có một Postgres thật ở đầu kia. Không đo
 * thời gian: thời gian trên máy đang tải là tiếng ồn, còn "bao nhiêu câu" là một con số xác
 * định, tái hiện được, và nói đúng thứ đang hỏng.
 *
 * Đếm bằng `logger` có sẵn của drizzle — nó được gọi cho MỌI câu drizzle phát ra. Drizzle,
 * migration và Postgres đều là đồ thật; chỉ `audit` và sổ thanh lý là bản rỗng, vì đường ĐỌC
 * không chạm tới chúng.
 */

const TEST_TIMEOUT = 120_000;
const DEVICES = 40;

describe('Tra nhiều thiết bị: một lượt, không phải mỗi dòng một lượt', () => {
  let scratch: ScratchDb;
  let counting: Pool;
  let queries = 0;
  let devices: DevicesService;
  let ids: string[];

  beforeAll(async () => {
    scratch = await createScratchDb('ims_batch_lookup');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });

    counting = new Pool({ connectionString: testDbUrl(scratch.name) });
    counting.on('error', () => undefined);

    /*
     * Đếm bằng `logger` CÓ SẴN của drizzle, không bọc tay `pool.query`.
     *
     * Bản đầu của bài này bọc `pool.query` rồi phải ép `any` hai chỗ — và eslint chặn đúng
     * (`no-unsafe-return`). Cửa này là cửa drizzle mở sẵn cho việc quan sát truy vấn, nên nó
     * vừa gọn vừa đúng kiểu, và nó đếm đúng thứ cần đếm: mọi câu drizzle phát ra.
     */
    const db = drizzle(counting, {
      logger: {
        logQuery: () => {
          queries += 1;
        },
      },
    }) as unknown as Database;
    const noAudit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const noRetirement = {
      holdingsWithin: () => Promise.resolve([]),
      releaseAllWithin: () => Promise.resolve(),
    } as unknown as DeviceRetirementRegistry;
    const catalog = new CatalogApiService(new CatalogService(db, noAudit));
    devices = new DevicesService(db, catalog, noAudit, noRetirement, new DeviceSearchRegistry());

    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('PC kiểm N+1') RETURNING id`,
    );
    const rows = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id)
       SELECT 'PC-NPLUS1-' || g, 'May ' || g, $1 FROM generate_series(1, $2) g
       RETURNING id`,
      [type.rows[0].id, DEVICES],
    );
    ids = rows.rows.map((r) => r.id);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await counting?.end();
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it(
    'HÌNH DẠNG CŨ: mỗi thiết bị một lượt `getById` — số truy vấn nhân lên theo số dòng',
    async () => {
      queries = 0;
      for (const id of ids) await devices.findOne(id);
      const perDevice = queries / DEVICES;

      /*
       * Bài này CỐ Ý khóa lại hình dạng cũ, để bài dưới có cái mà đối chiếu. Con số 8 không
       * phải phép màu: 1 câu đọc hàng `device` + 7 câu của `catalog.lists()`.
       */
      expect(perDevice).toBeGreaterThanOrEqual(8);
      expect(queries).toBeGreaterThanOrEqual(DEVICES * 8);
    },
    TEST_TIMEOUT,
  );

  it(
    'HÌNH DẠNG MỚI: cả danh sách tốn một số truy vấn CỐ ĐỊNH',
    async () => {
      queries = 0;
      const map = await devices.findByIds(ids);

      expect(map.size).toBe(DEVICES);
      /*
       * Không ghim đúng một con số: `catalog.lists()` có thể thêm một danh mục nữa ngày mai,
       * và bài kiểm đỏ vì lý do đó là bài kiểm gây phiền chứ không giữ gì. Thứ PHẢI đúng là:
       * số truy vấn KHÔNG phụ thuộc số dòng.
       */
      expect(queries).toBeLessThan(DEVICES);
      expect(queries).toBeLessThanOrEqual(12);
    },
    TEST_TIMEOUT,
  );

  it(
    'gấp đôi số dòng KHÔNG được làm tăng số truy vấn',
    async () => {
      queries = 0;
      await devices.findByIds(ids.slice(0, DEVICES / 2));
      const half = queries;

      queries = 0;
      await devices.findByIds(ids);
      const full = queries;

      // Đây mới là định nghĩa của "hết N+1" — không phải "nhanh hơn", mà "không lớn theo N".
      expect(full).toBe(half);
    },
    TEST_TIMEOUT,
  );

  it(
    'id không tồn tại thì VẮNG MẶT, không ném — một hàng hỏng không được làm sập cả bảng',
    async () => {
      const ghost = '00000000-0000-0000-0000-000000000000';
      const map = await devices.findByIds([...ids.slice(0, 3), ghost]);

      expect(map.size).toBe(3);
      expect(map.has(ghost)).toBe(false);
    },
    TEST_TIMEOUT,
  );

  it(
    'danh sách rỗng thì KHÔNG hỏi DB câu nào',
    async () => {
      queries = 0;
      const map = await devices.findByIds([]);
      expect(map.size).toBe(0);
      expect(queries).toBe(0);
    },
    TEST_TIMEOUT,
  );
});
