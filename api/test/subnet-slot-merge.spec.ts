import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../src/database/migration-runner';
import type { Database } from '../src/database/database.module';
import { IpAddressService } from '../src/modules/ipam/ip-address.service';
import type { SubnetService } from '../src/modules/ipam/subnet.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * MỘT ĐỊA CHỈ CÓ NHIỀU HÀNG — HÀNG SỐNG PHẢI THẮNG (F-10).
 *
 * ===== LỖ ĐANG VÁ, VÀ NÓ KHÔNG Ở CHỖ SỔ GHI =====
 *
 * Rà soát 19/09 ghi F-10 ở `web/src/features/ipam/subnet-detail.tsx:289`. Lúc vá (21/09) thì
 * file ấy không còn `Map` nào: luồng web giờ là `filterSlots → pageSlots`. Nhưng lỗi không
 * biến mất — nó **dời xuống api**, `IpAddressService.listBySubnet`:
 *
 *     const byAddress = new Map(records.map((row) => [row.address, row]));
 *
 * Nên bản vá này rộng hơn finding: hồi đó một màn sai, nay MỌI nơi gọi đều sai. Bài học nằm ở
 * chỗ khác chứ không ở mười dòng code: **một finding ghi theo `file:dòng` sẽ lệch khỏi mã
 * nguồn**, và người đọc lại sổ sau hai tuần rất dễ kết luận "đã vá rồi" chỉ vì đường dẫn
 * không còn khớp.
 *
 * ===== VÌ SAO MỘT ĐỊA CHỈ CÓ HAI HÀNG =====
 *
 * `ip_address_key` là UNIQUE **một phần**: `(subnet_id, address) WHERE voided_at IS NULL`.
 * Một hàng SỐNG cộng N hàng ĐÃ ẨN cùng địa chỉ là hợp lệ, và đó là đường đi bình thường —
 * ẩn nhầm một hồ sơ rồi cấp lại địa chỉ đó cho máy khác.
 *
 * Bật "Hiện hồ sơ đã ẩn" thì cả N+1 hàng cùng vào `records`, `new Map` giữ hàng CUỐI, và
 * "cuối" ở đây do Postgres quyết: `ORDER BY address` không định nghĩa thứ tự giữa hai hàng
 * CÙNG địa chỉ. Hậu quả: badge "Đã ẩn" cho một địa chỉ đang dùng, bộ đếm "Đang cấp" hụt 1, và
 * menu bày nút "Bật lại" cho hàng đang sống → API trả `IP_TAKEN`.
 *
 * Trông như "lúc đúng lúc sai" — kiểu lỗi không ai dựng lại được để báo.
 *
 * ===== NÓI THẲNG VỀ TÍNH TẤT ĐỊNH CỦA BÀI NÀY =====
 *
 * Thứ tự heap của Postgres không phải hợp đồng. Bài dưới gieo hàng ĐÃ ẨN **sau** hàng sống để
 * dựng lại đúng thế thua, và trên bản chưa vá nó đỏ. Nhưng điều bài này khoá KHÔNG phải "thứ
 * tự heap ra sao" — mà là **hàng sống thắng bất kể thứ tự nào**. Vế tất định của cùng luật ấy
 * nằm ở `ip-rules.spec.ts` (bảng dữ liệu, hàm thuần `keepPreferredByAddress`).
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.truc@pmh.com.vn';
const CIDR = '172.20.30.0/29';
const ADDRESS = '172.20.30.2';

describe('Ô địa chỉ trong dải khi một địa chỉ có nhiều hồ sơ', () => {
  let scratch: ScratchDb;
  let addresses: IpAddressService;
  let subnetId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_slot_merge');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = drizzle(scratch.pool) as unknown as Database;

    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const devices = {
      assertUsableWithin: () => Promise.resolve(),
      getByIds: () => Promise.resolve(new Map()),
    } as unknown as DevicesApiService;
    const subnets = {
      frameOf: () => Promise.resolve({ cidr: CIDR, voidedAt: null }),
      cidrOf: () => Promise.resolve(CIDR),
    } as unknown as SubnetService;
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    } as unknown as SystemConfigService;

    addresses = new IpAddressService(db, audit, devices, subnets, config);

    const subnet = await scratch.pool.query<{ id: string }>(
      `INSERT INTO subnet (name, cidr, created_by) VALUES ('Dai kiem gop o', $1, $2) RETURNING id`,
      [CIDR, ACTOR],
    );
    subnetId = subnet.rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await scratch.pool.query('DELETE FROM ip_history');
    await scratch.pool.query('DELETE FROM ip_address');
  });

  /** Một hồ sơ ĐÃ ẨN ở địa chỉ trên — quá khứ của địa chỉ ấy. */
  async function seedVoided(usedBy: string): Promise<void> {
    await scratch.pool.query(
      `INSERT INTO ip_address (subnet_id, address, status, used_by, assigned_by,
                               voided_at, voided_by, void_reason)
       VALUES ($1, $2, 'reclaimed', $3, $4, now(), $4, 'Go nham')`,
      [subnetId, ADDRESS, usedBy, ACTOR],
    );
  }

  /** Hồ sơ ĐANG SỐNG ở địa chỉ ấy. */
  async function seedLive(usedBy: string): Promise<void> {
    await scratch.pool.query(
      `INSERT INTO ip_address (subnet_id, address, status, used_by, assigned_by)
       VALUES ($1, $2, 'assigned', $3, $4)`,
      [subnetId, ADDRESS, usedBy, ACTOR],
    );
  }

  async function slotAt(includeVoided: boolean) {
    const slots = await addresses.listBySubnet(subnetId, includeVoided);
    return slots.find((slot) => slot.address === ADDRESS);
  }

  it(
    'hàng SỐNG gieo trước, hàng ĐÃ ẨN gieo sau → ô vẫn phải là hàng sống',
    async () => {
      await seedLive('Phong Ke toan');
      await seedVoided('Chu cu da go');

      const slot = await slotAt(true);
      expect(slot?.kind).toBe('record');
      // Thứ người dùng nhìn thấy: ai đang dùng địa chỉ này, và nó có đang sống không.
      expect(slot && 'usedBy' in slot ? slot.usedBy : null).toBe('Phong Ke toan');
      expect(slot && 'voidedAt' in slot ? slot.voidedAt : 'thieu-cot').toBeNull();
      expect(slot && 'status' in slot ? slot.status : null).toBe('assigned');
    },
    TEST_TIMEOUT,
  );

  it(
    'hàng ĐÃ ẨN gieo trước → vẫn là hàng sống (vế chứng minh luật không phụ thuộc thứ tự)',
    async () => {
      await seedVoided('Chu cu da go');
      await seedLive('Phong Ke toan');

      const slot = await slotAt(true);
      expect(slot && 'usedBy' in slot ? slot.usedBy : null).toBe('Phong Ke toan');
    },
    TEST_TIMEOUT,
  );

  it(
    'BA hàng đã ẩn vây quanh một hàng sống → hàng sống vẫn thắng',
    async () => {
      await seedVoided('Chu thu nhat');
      await seedLive('Phong Ke toan');
      await seedVoided('Chu thu hai');
      await seedVoided('Chu thu ba');

      const slot = await slotAt(true);
      expect(slot && 'usedBy' in slot ? slot.usedBy : null).toBe('Phong Ke toan');
    },
    TEST_TIMEOUT,
  );

  it(
    'CHỈ có hàng đã ẩn → ô hiện hàng đã ẩn, không biến thành "trống"',
    async () => {
      // Vế đối chứng: luật là "sống thắng ẩn", không phải "bỏ hết hàng ẩn". Bỏ đi thì nút
      // "Bật lại" mất đường tới, đúng thứ `includeVoided` sinh ra để tránh.
      await seedVoided('Chu cu da go');

      const slot = await slotAt(true);
      expect(slot?.kind).toBe('record');
      expect(slot && 'usedBy' in slot ? slot.usedBy : null).toBe('Chu cu da go');
    },
    TEST_TIMEOUT,
  );

  it(
    'KHÔNG bật "hiện hồ sơ đã ẩn" → hàng đã ẩn biến thành ô trống (vế đối chứng)',
    async () => {
      await seedVoided('Chu cu da go');

      const slot = await slotAt(false);
      expect(slot?.kind).toBe('free');
    },
    TEST_TIMEOUT,
  );
});
