import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, testDbUrl, type ScratchDb, waitForLock } from './db';

/**
 * ĐỔI DẢI vs KHAI IP — cuộc đua chỉ hai kết nối THẬT mới hỏi được.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `SubnetService.update` chặn đổi `cidr` khi dải đã có hồ sơ IP, và chú thích tại đó nói rõ
 * vì sao: IP nằm ngoài dải mới "trở thành rác lặng lẽ — trigger chỉ chạy khi INSERT/UPDATE
 * chính hàng IP, nên chúng ở lại, vẫn hiện trên màn hình, vẫn trông hợp lệ".
 *
 * Nhưng hàng rào đó đếm IP NGOÀI transaction, còn trigger `ip_address_within_subnet()` đọc
 * `subnet.cidr` bằng SELECT trần. Ở READ COMMITTED hai bên không thấy nhau, nên trình tự
 * hoàn toàn bình thường này lọt:
 *
 *     T1 đếm IP = 0  →  T2 khai 10.0.0.5 (trigger đọc dải CŨ, hợp lệ) COMMIT  →  T1 đổi dải.
 *
 * Kết quả: một hàng 10.0.0.5 trong một dải 192.168.1.0/24. Không lỗi, không cảnh báo.
 *
 * ===== VÌ SAO PHẢI Ở TẦNG NÀY =====
 *
 * Bài kiểm đơn vị không hỏi được: cấm mock drizzle, và mock thì cũng không có bộ quản lý khóa
 * của Postgres để mà đo. E2E cũng không: nó chạy tuần tự qua HTTP, không giữ được một
 * transaction mở giữa chừng để chèn transaction thứ hai vào đúng khe hở. Chỉ hai kết nối thật,
 * mỗi bên một transaction mở, mới dựng lại được đúng khe hở đó.
 *
 * Bài này khóa HỢP ĐỒNG KHÓA (migration 0040 + `FOR UPDATE` trong `update()`) chứ không đi
 * qua service: dựng cả `SubnetService` cần audit + catalog + Nest container, trong khi thứ
 * đang kiểm là hành vi của Postgres. Đổi lại, hai câu lệnh ở đây phải KHỚP NGUYÊN VĂN thứ
 * service chạy — nếu ai đó bỏ `FOR UPDATE` khỏi service thì bài này vẫn xanh mà lỗi quay lại.
 * Bài `subnet-lock-contract` ở cuối file canh đúng chuyện đó.
 */

const TEST_TIMEOUT = 120_000;
const OLD_CIDR = '10.0.0.0/24';
const NEW_CIDR = '192.168.1.0/24';

describe('Đổi dải và khai IP không được đè lên nhau', () => {
  let scratch: ScratchDb;
  let subnetId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_race');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await scratch.pool.query('DELETE FROM ip_address');
    await scratch.pool.query('DELETE FROM subnet');
    const rows = await scratch.pool.query<{ id: string }>(
      `INSERT INTO subnet (name, cidr, created_by) VALUES ('Dải E2 đua', $1, 'test') RETURNING id`,
      [OLD_CIDR],
    );
    subnetId = rows.rows[0].id;
  });

  /** Một kết nối riêng, tách hẳn khỏi pool — hai bên phải là hai session Postgres khác nhau. */
  async function connection() {
    const pool = new Pool({ connectionString: testDbUrl(scratch.name), max: 1 });
    pool.on('error', () => undefined);
    const client = await pool.connect();
    return {
      client,
      close: async () => {
        client.release();
        await pool.end();
      },
    };
  }

  /** Đúng cặp câu lệnh mà `SubnetService.update` chạy khi đổi dải. */
  async function claimSubnetForCidrChange(client: PoolClient): Promise<number> {
    await client.query('SELECT 1 FROM subnet WHERE id = $1 FOR UPDATE', [subnetId]);
    const counted = await client.query<{ used: string }>(
      'SELECT count(*) AS used FROM ip_address WHERE subnet_id = $1 AND voided_at IS NULL',
      [subnetId],
    );
    return Number(counted.rows[0].used);
  }

  function insertIp(client: PoolClient, address: string) {
    return client.query(
      `INSERT INTO ip_address (subnet_id, address, assigned_by) VALUES ($1, $2, 'test')`,
      [subnetId, address],
    );
  }

  it(
    'ĐỔI DẢI đi trước: lượt khai IP đang chờ phải bị dải MỚI từ chối',
    async () => {
      const changer = await connection();
      const creator = await connection();
      try {
        await changer.client.query('BEGIN');
        expect(await claimSubnetForCidrChange(changer.client)).toBe(0);

        /*
         * Lượt khai IP bắt đầu SAU khi T1 đã khóa nhưng TRƯỚC khi T1 commit — đúng khe hở mà
         * bản cũ để lọt. `FOR SHARE` trong trigger phải làm nó ĐỨNG LẠI ở đây, chứ không phải
         * đọc dải cũ rồi đi tiếp.
         */
        await creator.client.query('BEGIN');
        const blocked = insertIp(creator.client, '10.0.0.5');
        let settled = false;
        void blocked.then(
          () => (settled = true),
          () => (settled = true),
        );
        await waitForLock(scratch.pool);
        // Đứng lại ở đây là điều kiện SỐNG CÒN của bài: chạy tiếp nghĩa là lỗ cũ còn nguyên.
        expect(settled).toBe(false);

        await changer.client.query('UPDATE subnet SET cidr = $1 WHERE id = $2', [
          NEW_CIDR,
          subnetId,
        ]);
        await changer.client.query('COMMIT');

        // Mở khóa xong, trigger đọc LẠI và thấy dải mới → 10.0.0.5 không còn nằm trong dải.
        await expect(blocked).rejects.toThrow(/không nằm trong dải/);
        await creator.client.query('ROLLBACK');

        const left = await scratch.pool.query('SELECT count(*)::int AS n FROM ip_address');
        expect(left.rows[0].n).toBe(0); // không hồ sơ IP nào được ở lại ngoài dải
      } finally {
        await changer.close();
        await creator.close();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'KHAI IP đi trước: lượt đổi dải phải đếm được IP vừa khai và từ chối',
    async () => {
      const creator = await connection();
      const changer = await connection();
      try {
        await creator.client.query('BEGIN');
        await insertIp(creator.client, '10.0.0.7');

        /*
         * GHI RÕ BÀI NÀY CHỨNG MINH GÌ (đã đo bằng đột biến): bỏ `FOR SHARE` khỏi trigger thì
         * bài này VẪN XANH — vì khóa nó dựa vào không phải của trigger mà của KHÓA NGOẠI.
         * Postgres tự lấy `FOR KEY SHARE` trên hàng cha khi INSERT hàng con, và `FOR UPDATE`
         * xung khắc với nó. Nên bài này canh THỨ TỰ ở phía service (khóa trước, đếm sau, cùng
         * một tx), còn bài "ĐỔI DẢI đi trước" mới là bài chết khi trigger mất `FOR SHARE`.
         */
        await changer.client.query('BEGIN');
        const claim = claimSubnetForCidrChange(changer.client);
        let settled = false;
        void claim.then(
          () => (settled = true),
          () => (settled = true),
        );
        await waitForLock(scratch.pool);
        // Phải CHỜ, không được đếm trên ảnh chụp cũ.
        expect(settled).toBe(false);

        await creator.client.query('COMMIT');

        /*
         * ĐÂY LÀ CÂU CHỐT. Bản cũ đếm ngoài transaction nên sẽ ra 0 và cho đổi dải; nay nó chờ
         * xong mới đếm, và thấy đúng 1 hồ sơ IP.
         */
        expect(await claim).toBe(1); // thấy IP vừa commit, không phải ảnh chụp cũ
        await changer.client.query('ROLLBACK');
      } finally {
        await creator.close();
        await changer.close();
      }
    },
    TEST_TIMEOUT,
  );

  /**
   * Vế đối chứng: khóa không được làm chậm việc bình thường. Nhiều IP CÙNG một dải khai song
   * song chỉ xin khóa CHIA SẺ, nên chúng không chờ nhau — nếu `FOR SHARE` bị đổi tay thành
   * `FOR UPDATE`, bài này đỏ và cứu cả màn khai IP khỏi việc xếp hàng một.
   */
  it(
    'hai lượt khai IP cùng dải KHÔNG chờ nhau',
    async () => {
      const a = await connection();
      const b = await connection();
      try {
        await a.client.query('BEGIN');
        await insertIp(a.client, '10.0.0.11');

        await b.client.query('BEGIN');
        await insertIp(b.client, '10.0.0.12'); // không được treo ở đây

        await a.client.query('COMMIT');
        await b.client.query('COMMIT');

        const n = await scratch.pool.query('SELECT count(*)::int AS n FROM ip_address');
        expect(n.rows[0].n).toBe(2);
      } finally {
        await a.close();
        await b.close();
      }
    },
    TEST_TIMEOUT,
  );

  /**
   * `SubnetService.update` PHẢI khóa hàng subnet rồi mới đếm, và phải làm cả hai TRONG
   * transaction. Ba bài trên đo hành vi của Postgres; bài này canh phía TypeScript, vì bỏ
   * `FOR UPDATE` khỏi service sẽ mở lại đúng lỗ cũ mà ba bài kia vẫn xanh.
   */
  it('service giữ đúng hợp đồng khóa: FOR UPDATE trước, đếm sau, cùng một tx', async () => {
    const source = await readFile(
      join(__dirname, '..', 'src', 'modules', 'ipam', 'subnet.service.ts'),
      'utf8',
    );

    const body = source.slice(source.indexOf('async update('), source.indexOf('async voidSubnet('));
    const lockAt = body.indexOf('FOR UPDATE');
    const countAt = body.indexOf('.select({ used: count() })');
    const txAt = body.indexOf('this.db.transaction');

    expect(lockAt).toBeGreaterThan(-1); // update() phải có SELECT ... FOR UPDATE
    expect(countAt).toBeGreaterThan(-1);
    expect(txAt).toBeGreaterThan(-1);
    expect(txAt).toBeLessThan(lockAt);
    expect(lockAt).toBeLessThan(countAt); // khóa đứng TRƯỚC câu đếm
    expect(body.slice(countAt - 200, countAt)).toContain('await tx'); // đếm chạy trên `tx`
  });
});
