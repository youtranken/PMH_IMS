import { Pool } from 'pg';
import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * BẬT LẠI MỘT HỒ SƠ IP ĐÃ ẨN — cửa mà trigger "IP phải nằm trong dải" không canh.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `ip_address_within_subnet_upd` khai `BEFORE UPDATE **OF address, subnet_id**`. Danh sách cột
 * đó là một bộ lọc: Postgres chỉ gọi trigger khi câu UPDATE có nhắc tới một trong hai cột.
 * `IpAddressService.restore()` chỉ đặt `voided_at`, `voided_by`, `void_reason`, `updated_at`
 * — không cột nào trong danh sách — nên trigger KHÔNG BAO GIỜ chạy trên đường bật lại.
 *
 * Ghép với hàng rào đổi dải, ba thao tác hoàn toàn bình thường dựng lại đúng trạng thái mà
 * khoá `FOR SHARE` trong `ip_address_within_subnet` (`0030_ip_address.sql`) sinh ra để chặn:
 *
 *   1. Ẩn hồ sơ 10.0.0.5 ("khai nhầm địa chỉ").
 *   2. Sửa dải sang 192.168.1.0/24 — ĐƯỢC, vì `SubnetService.update` chỉ đếm IP đang sống
 *      (`voided_at IS NULL`), và hồ sơ vừa ẩn không được đếm.
 *   3. Bấm "Bật lại" hồ sơ đó.
 *
 * Không cần cuộc đua nào, không cần lỗi hạ tầng nào. Kết quả là một hàng 10.0.0.5 nằm trong
 * dải 192.168.1.0/24 — và nó TỆ HƠN kết quả của cuộc đua mà khoá đó chặn: `listBySubnet` liệt kê host
 * theo cidr MỚI nên hàng này vô hình trên mọi màn dải, trong khi `listForDevice` và sổ NAT
 * vẫn trả nó ra.
 *
 * ===== VÌ SAO Ở TẦNG NÀY, KHÔNG PHẢI UNIT =====
 *
 * Thứ đang kiểm là hành vi của Postgres: danh sách cột trong `UPDATE OF` quyết định trigger
 * có chạy hay không. Không mock nào diễn lại được luật đó (và CLAUDE.md cấm mock drizzle).
 * Bài này khóa hợp đồng ở tầng DB, nên nó còn đúng cho cả những đường ghi viết sau này —
 * kể cả đường không đi qua `restore()`.
 */

const TEST_TIMEOUT = 120_000;
const OLD_CIDR = '10.0.0.0/24';
const NEW_CIDR = '192.168.1.0/24';
const ADDRESS = '10.0.0.5';

describe('Bật lại hồ sơ IP không được đưa một địa chỉ ra ngoài dải', () => {
  let scratch: ScratchDb;
  let pool: Pool;
  let subnetId: string;
  let addressId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_restore');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    pool = scratch.pool;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await pool.query('DELETE FROM ip_history');
    await pool.query('DELETE FROM ip_address');
    await pool.query('DELETE FROM subnet');
    const subnet = await pool.query<{ id: string }>(
      `INSERT INTO subnet (name, cidr, created_by) VALUES ('Dải bật lại', $1, 'test') RETURNING id`,
      [OLD_CIDR],
    );
    subnetId = subnet.rows[0].id;
    const ip = await pool.query<{ id: string }>(
      `INSERT INTO ip_address (subnet_id, address, status, assigned_by)
       VALUES ($1, $2, 'free', 'test') RETURNING id`,
      [subnetId, ADDRESS],
    );
    addressId = ip.rows[0].id;
  });

  /** Đúng ba bước người dùng thật bấm được, không cuộc đua nào. */
  it('ẩn IP → đổi dải → bật lại: phải BỊ TỪ CHỐI, không được để lại hàng ngoài dải', async () => {
    await pool.query(
      `UPDATE ip_address SET voided_at = now(), voided_by = 'test', void_reason = 'khai nhầm'
       WHERE id = $1`,
      [addressId],
    );

    // Hàng rào đổi dải chỉ đếm IP đang sống, nên bước này ĐƯỢC PHÉP — đó là tiền đề của lỗ.
    const live = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM ip_address WHERE subnet_id = $1 AND voided_at IS NULL`,
      [subnetId],
    );
    expect(Number(live.rows[0].n)).toBe(0);
    await pool.query(`UPDATE subnet SET cidr = $1 WHERE id = $2`, [NEW_CIDR, subnetId]);

    await expect(
      pool.query(
        `UPDATE ip_address SET voided_at = NULL, voided_by = NULL, void_reason = NULL,
                               updated_at = now()
         WHERE id = $1 AND voided_at IS NOT NULL`,
        [addressId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    const after = await pool.query<{ voided_at: Date | null }>(
      `SELECT voided_at FROM ip_address WHERE id = $1`,
      [addressId],
    );
    expect(after.rows[0].voided_at).not.toBeNull();
  });

  /**
   * VẾ ĐỐI CHỨNG — không có nó thì một bản vá chặn-hết-cho-chắc (cấm luôn mọi lượt bật lại)
   * cũng làm bài trên xanh, và tính năng "Bật lại" chết mà không ai biết.
   */
  it('ẩn IP rồi bật lại khi dải KHÔNG đổi: phải chạy được bình thường', async () => {
    await pool.query(
      `UPDATE ip_address SET voided_at = now(), voided_by = 'test', void_reason = 'khai nhầm'
       WHERE id = $1`,
      [addressId],
    );

    const restored = await pool.query(
      `UPDATE ip_address SET voided_at = NULL, voided_by = NULL, void_reason = NULL,
                             updated_at = now()
       WHERE id = $1 AND voided_at IS NOT NULL`,
      [addressId],
    );
    expect(restored.rowCount).toBe(1);

    const after = await pool.query<{ voided_at: Date | null }>(
      `SELECT voided_at FROM ip_address WHERE id = $1`,
      [addressId],
    );
    expect(after.rows[0].voided_at).toBeNull();
  });

  /**
   * Ẩn hồ sơ KHÔNG được kích hàng rào. Nếu bản vá canh MỌI lượt đụng `voided_at`, thì
   * `voidSubnet` — đường DỌN một dải đã thu hẹp — sẽ nổ giữa chừng, và người dùng mất luôn
   * đường duy nhất để dọn rác. Hàng rào phải hỏi "hàng này có ĐANG SỐNG không", không phải
   * "cột voided_at có bị đụng không".
   */
  it('ẩn một hồ sơ đang nằm ngoài dải vẫn phải làm được — ẩn là đường DỌN, không phải đường tạo rác', async () => {
    // Dựng trạng thái "hàng sống nằm ngoài dải" ngay ở DB: đổi cidr không kích trigger nào.
    await pool.query(`UPDATE subnet SET cidr = $1 WHERE id = $2`, [NEW_CIDR, subnetId]);

    const hidden = await pool.query(
      `UPDATE ip_address SET voided_at = now(), voided_by = 'test', void_reason = 'dọn rác'
       WHERE id = $1 AND voided_at IS NULL`,
      [addressId],
    );
    expect(hidden.rowCount).toBe(1);
  });
});

/**
 * HAI NGƯỜI CÙNG BẤM "BẬT LẠI" — hợp đồng CAS trên `voided_at`.
 *
 * `restore()` kiểm `voidedAt !== null` NGOÀI transaction rồi ghi bên trong. Nếu câu ghi không
 * mang điều kiện đó theo, hai lượt chồng nhau đều ghi được, và `audit_log` cùng `ip_history`
 * — hai bảng CHỈ-THÊM (AD-13) — để lại HAI dòng `ip.restored` cho MỘT lần bật lại. Không có
 * đường bù: xoá dòng lịch sử là đúng thứ AD-13 cấm.
 *
 * VÌ SAO KHÔNG PHẢI E2E. Tôi đã viết bài đó ở tầng E2E trước (6 request song song) và nó XANH
 * ngay trên code CHƯA vá — tức nó không phân biệt được gì. Sáu request qua một
 * `APIRequestContext` không chồng lên nhau đủ để mở khe hở. Ở đây thì hai kết nối thật, hai
 * transaction mở tường minh, và khe hở được ép ra chứ không trông chờ vào may rủi lịch biểu.
 *
 * GIỚI HẠN, nói thẳng: bài này khoá hợp đồng của CÂU SQL, không chứng minh service dùng đúng
 * câu đó — giống hệt điều đã ghi ở `subnet-cidr-race.spec.ts`. Vế còn lại do bài E2E
 * "ẩn IP rồi bật lại khi dải không đổi" giữ: nó chạy qua service thật.
 */
describe('Bật lại hai lượt chồng nhau chỉ được thắng một', () => {
  let scratch: ScratchDb;
  let pool: Pool;
  let addressId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_restore_cas');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    pool = scratch.pool;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await pool.query('DELETE FROM ip_address');
    await pool.query('DELETE FROM subnet');
    const subnet = await pool.query<{ id: string }>(
      `INSERT INTO subnet (name, cidr, created_by) VALUES ('Dải CAS', $1, 'test') RETURNING id`,
      [OLD_CIDR],
    );
    const ip = await pool.query<{ id: string }>(
      `INSERT INTO ip_address (subnet_id, address, status, assigned_by, voided_at, voided_by, void_reason)
       VALUES ($1, $2, 'free', 'test', now(), 'test', 'khai nhầm') RETURNING id`,
      [subnet.rows[0].id, ADDRESS],
    );
    addressId = ip.rows[0].id;
  });

  const RESTORE = `UPDATE ip_address
       SET voided_at = NULL, voided_by = NULL, void_reason = NULL, updated_at = now()
     WHERE id = $1 AND voided_at IS NOT NULL`;

  it('lượt thứ hai phải khớp 0 dòng, không phải ghi đè lượt thứ nhất', async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');

      const first = await a.query(RESTORE, [addressId]);
      expect(first.rowCount).toBe(1);

      // B đâm vào cùng hàng: chặn ở khoá hàng cho tới khi A commit, rồi ĐỌC LẠI phiên bản mới.
      const second = b.query(RESTORE, [addressId]);
      await a.query('COMMIT');
      const secondResult = await second;

      // Không có vị từ `voided_at IS NOT NULL` trong câu ghi thì lượt này khớp 1 dòng và ghi
      // đè lượt trước — hai dòng `ip.restored` cho một lần bật lại.
      expect(secondResult.rowCount).toBe(0);
      await b.query('COMMIT');
    } finally {
      a.release();
      b.release();
    }

    const rows = await pool.query<{ voided_at: Date | null }>(
      `SELECT voided_at FROM ip_address WHERE id = $1`,
      [addressId],
    );
    expect(rows.rows[0].voided_at).toBeNull();
  });
});
