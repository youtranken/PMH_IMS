import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../src/database/migration-runner';
import type { Database } from '../src/database/database.module';
import { IpAddressService } from '../src/modules/ipam/ip-address.service';
import { IpDeviceRetirement } from '../src/modules/ipam/ip-device-retirement';
import type { NatRuleService } from '../src/modules/ipam/nat-rule.service';
import type { SubnetService } from '../src/modules/ipam/subnet.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * MỘT IP "ĐÃ THU HỒI" MÀ VẪN MANG TÊN MỘT CÁI MÁY LÀ MỘT CÁI BẪY KHÓA CỨNG.
 *
 * ===== LỖ ĐANG VÁ (A-06, rà soát 19/09) =====
 *
 * `update()` tự suy ra bước chuyển khi một hồ sơ IP được gán chủ — nhưng chỉ suy đúng MỘT
 * trạng thái nguồn:
 *
 *     const becomesAssigned = before.status === 'free' && Boolean(owner);
 *
 * `reclaimed` cũng là chỗ TRỐNG (`OCCUPYING_STATUSES` không có nó) và `reclaimed → assigned`
 * là đường đi hợp lệ, có hẳn tên tiếng Việt "Cấp lại". Nhưng nó không nằm trong phép so trên,
 * nên gán máy cho một IP đã thu hồi đẻ ra một hàng lai: `device_id = X` mà `status =
 * reclaimed`.
 *
 * Rồi hàng lai đó khóa cứng thiết bị X — CẢ HAI lối thanh lý đều tắc:
 *
 *   · KHÔNG tick "dọn hộ": `listForDeviceWithin` không lọc trạng thái nên hàng này vẫn bị đếm
 *     là tài sản đang giữ → `DEVICE_HAS_HOLDINGS`, chặn.
 *   · CÓ tick "dọn hộ": `releaseWithin` gọi `transitionWithin(…, 'reclaimed')` lên một hàng
 *     ĐÃ `reclaimed` → `IP_TRANSITION_INVALID`, và cả transaction thanh lý rollback.
 *
 * Người trực bấm Thanh lý và nhận một câu lỗi nói về một thứ họ không hề đụng tới. Không có
 * đường nào đi tiếp, trừ sửa tay trong DB.
 *
 * ===== VÁ HAI ĐẦU, VÌ HAI ĐẦU HỎNG THEO HAI KIỂU =====
 *
 *   1. `update()` hỏi `isOccupying` thay vì liệt kê tay một trạng thái. Đó vốn là vị từ dùng
 *      chung của module (FR-020 đếm mức sử dụng bằng chính nó): hàng KHÔNG chiếm chỗ mà được
 *      gán chủ thì thành `assigned`. Liệt kê tay là chỗ người ta quên bổ sung khi thêm trạng
 *      thái mới; hỏi vị từ chung thì không.
 *
 *   2. `listForDeviceWithin` lọc theo `isOccupying`. Đây là vế cho DỮ LIỆU ĐÃ LỠ SINH RA —
 *      một địa chỉ đã trả về pool KHÔNG phải là tài sản thiết bị đang giữ, dù cột `device_id`
 *      còn ghi tên nó. Sửa mỗi đầu 1 thì những hàng lai đang nằm sẵn trong DB vẫn khóa cứng
 *      máy của chúng mãi mãi.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.truc@pmh.com.vn';

describe('Hồ sơ IP đã thu hồi mà vẫn mang tên máy', () => {
  let scratch: ScratchDb;
  let addresses: IpAddressService;
  let retirement: IpDeviceRetirement;
  let deviceId: string;
  let subnetId: string;
  /** Địa chỉ mà `IpDeviceRetirement` hỏi sổ NAT — vế thứ hai của phép lọc. */
  let addressesAskedOfNat: string[] = [];

  beforeAll(async () => {
    scratch = await createScratchDb('ims_ip_reclaimed');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = drizzle(scratch.pool) as unknown as Database;

    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const devices = {
      assertUsableWithin: () => Promise.resolve(),
      getByIds: () => Promise.resolve(new Map()),
    } as unknown as DevicesApiService;
    const subnets = {
      cidrOf: () => Promise.resolve(`172.16.${subnetIndex}.0/24`),
    } as unknown as SubnetService;
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    } as unknown as SystemConfigService;

    addresses = new IpAddressService(db, audit, devices, subnets, config);

    const nat = {
      rulesTouchingDevice: (_tx: unknown, _id: string, list: string[]) => {
        addressesAskedOfNat = list;
        return Promise.resolve([]);
      },
      voidForDeviceWithin: () => Promise.resolve(),
    } as unknown as NatRuleService;
    const registry = { register: () => undefined } as unknown as DeviceRetirementRegistry;
    retirement = new IpDeviceRetirement(registry, addresses, nat);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  /**
   * MỖI BÀI MỘT DẢI RIÊNG, thay cho `DELETE` giữa các bài.
   *
   * `ip_history` là bảng chỉ-thêm và có hàng rào DB chặn thẳng DELETE (AD-13) — đúng luật, và
   * bài kiểm không được phép là ngoại lệ của chính luật nó đang canh. Bản đầu của file này
   * `DELETE FROM ip_history` trong `beforeEach` nên CẢ BẢY ca đỏ, kể cả hai vế đối chứng —
   * và "đối chứng cũng đỏ" là dấu hiệu dàn cảnh sai chứ không phải mã sai.
   * `security-probe-race.spec.ts` đã gặp đúng chuyện này và giải bằng cùng một cách.
   */
  let subnetIndex = 0;

  beforeEach(async () => {
    addressesAskedOfNat = [];
    subnetIndex += 1;

    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ($1) RETURNING id`,
      [`PC ${subnetIndex}`],
    );
    const device = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id, status)
       VALUES ($1, 'May ke toan', $2, 'in_use') RETURNING id`,
      [`PC-IP-${subnetIndex}`, type.rows[0].id],
    );
    deviceId = device.rows[0].id;

    const subnet = await scratch.pool.query<{ id: string }>(
      `INSERT INTO subnet (name, cidr, created_by)
       VALUES ($1, $2, $3) RETURNING id`,
      [`Dai kiem IP ${subnetIndex}`, `172.16.${subnetIndex}.0/24`, ACTOR],
    );
    subnetId = subnet.rows[0].id;
  });

  /** Địa chỉ duy nhất của bài đang chạy — dải riêng nên không bao giờ đụng bài khác. */
  function addressOfTest(): string {
    return `172.16.${subnetIndex}.5`;
  }

  /** Một hồ sơ IP ở trạng thái bất kỳ, tùy bài cần. */
  async function seedIp(
    status: string,
    owner: { deviceId?: string | null } = {},
  ): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO ip_address (subnet_id, address, status, device_id, assigned_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [subnetId, addressOfTest(), status, owner.deviceId ?? null, ACTOR],
    );
    return rows[0].id;
  }

  async function statusOf(id: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ status: string }>(
      `SELECT status FROM ip_address WHERE id = $1`,
      [id],
    );
    return rows[0].status;
  }

  describe('gán chủ qua đường sửa hồ sơ', () => {
    it(
      'IP ĐÃ THU HỒI được gán máy → phải thành "đang cấp", không nằm lại ở "đã thu hồi"',
      async () => {
        const ipId = await seedIp('reclaimed');
        await addresses.update(ACTOR, ipId, { deviceId });
        expect(await statusOf(ipId)).toBe('assigned');
      },
      TEST_TIMEOUT,
    );

    it(
      'IP TRỐNG được gán máy → vẫn như cũ (vế đối chứng: bản vá không đổi đường đang đúng)',
      async () => {
        const ipId = await seedIp('free');
        await addresses.update(ACTOR, ipId, { deviceId });
        expect(await statusOf(ipId)).toBe('assigned');
      },
      TEST_TIMEOUT,
    );

    it(
      'IP NGHI CHẾT được sửa ghi chú → KHÔNG bị kéo về "đang cấp" sau lưng người dùng',
      async () => {
        // `suspect_dead → assigned` là lượt XÁC NHẬN VẪN DÙNG, một quyết định của con người
        // có nhãn riêng và dòng lịch sử riêng. Tự suy hộ là cướp mất quyết định đó.
        const ipId = await seedIp('suspect_dead', { deviceId });
        await addresses.update(ACTOR, ipId, { note: 'Da goi cho chu may, chua bat may' });
        expect(await statusOf(ipId)).toBe('suspect_dead');
      },
      TEST_TIMEOUT,
    );

    it(
      'dòng lịch sử của bước chuyển phải ghi đúng trạng thái NGUỒN, không cứng "free"',
      async () => {
        const ipId = await seedIp('reclaimed');
        await addresses.update(ACTOR, ipId, { deviceId });
        const { rows } = await scratch.pool.query<{ from_status: string; to_status: string }>(
          `SELECT from_status, to_status FROM ip_history
            WHERE ip_address_id = $1 AND action = 'ip.assigned'`,
          [ipId],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].from_status).toBe('reclaimed');
        expect(rows[0].to_status).toBe('assigned');
      },
      TEST_TIMEOUT,
    );
  });

  describe('hàng lai đã nằm sẵn trong DB — thiết bị phải thanh lý được', () => {
    it(
      'IP "đã thu hồi" mang device_id KHÔNG phải tài sản đang giữ',
      async () => {
        await seedIp('reclaimed', { deviceId });
        const holdings = await retirement.holdingsOf(scratch.db, deviceId);
        expect(holdings).toEqual([]);
        // Sổ NAT cũng không được hỏi theo một địa chỉ đã trả về pool.
        expect(addressesAskedOfNat).toEqual([]);
      },
      TEST_TIMEOUT,
    );

    it(
      'lượt dọn hộ KHÔNG đâm vào IP_TRANSITION_INVALID trên hàng đã thu hồi',
      async () => {
        const stale = await seedIp('reclaimed', { deviceId });
        await expect(
          scratch.db.transaction((tx) => retirement.releaseWithin(tx, ACTOR, deviceId)),
        ).resolves.toBeUndefined();
        // Hàng cũ không bị đụng tới: nó đã ở đúng chỗ của nó rồi.
        expect(await statusOf(stale)).toBe('reclaimed');
      },
      TEST_TIMEOUT,
    );

    it(
      'IP ĐANG CẤP thì vẫn là tài sản đang giữ, và vẫn được thu hồi (vế đối chứng)',
      async () => {
        const live = await seedIp('assigned', { deviceId });
        expect(await retirement.holdingsOf(scratch.db, deviceId)).toEqual([
          `địa chỉ IP ${addressOfTest()}`,
        ]);
        await scratch.db.transaction((tx) => retirement.releaseWithin(tx, ACTOR, deviceId));
        expect(await statusOf(live)).toBe('reclaimed');
      },
      TEST_TIMEOUT,
    );
  });
});
