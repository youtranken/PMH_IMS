import { Pool, type PoolClient } from 'pg';
import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, testDbUrl, type ScratchDb } from './db';

/**
 * AI LÀ TRỌNG TÀI CHO "BOTH CHỒNG LÊN TCP"?
 *
 * ===== LỖ ĐANG VÁ (A-04, rà soát 19/09) =====
 *
 * Sổ NAT tồn tại để trả lời MỘT câu: "port 8080 trên router này mở cho ai". Hai dòng cùng
 * phủ TCP/8080 thì câu trả lời là hai, và cuốn sổ mất đúng công dụng của nó.
 *
 * Một `EXCLUDE` so `protocol WITH =` KHÔNG bao giờ thấy `both` va `tcp` — cố ý, để TCP và UDP
 * riêng được khai chung port, còn phần còn lại nhường cho service. Nhưng
 * `requireNoProtocolOverlap` chạy trên `this.db`, NGOÀI mọi transaction, TRƯỚC khi
 * `db.transaction` mở ra. Nên nó là một phép đọc-rồi-quyết không khóa gì:
 *
 *     T1 đọc siblings → không thấy gì      T2 đọc siblings → không thấy gì
 *     T1 BEGIN; INSERT tcp 8080; COMMIT    T2 BEGIN; INSERT both 8080; COMMIT
 *
 * Cả hai qua cửa. DB không chặn vì `'tcp' <> 'both'`. Sổ có hai câu trả lời cho TCP/8080.
 *
 * ===== VÌ SAO VÁ Ở TẦNG DB, KHÔNG PHẢI THÊM MỘT CÁI KHÓA =====
 *
 * Cách hiển nhiên là kéo phép kiểm vào trong transaction rồi khóa hàng `device` lại. Nó chạy
 * được, nhưng nó đẻ ra một QUY ƯỚC: "ai ghi vào `nat_rule` thì phải nhớ khóa router trước".
 * Quy ước là thứ người ta quên — và cả đợt rà soát này, sáu trên sáu lỗ đều là một quy ước bị
 * quên ở đúng MỘT cửa trong nhiều cửa.
 *
 * Ràng buộc DB thì không quên được. Mẹo ở đây là ánh xạ giao thức thành một KHOẢNG rồi hỏi
 * `&&` thay vì `=`:
 *
 *     tcp → [1,1]      udp → [2,2]      both → [1,2]
 *
 * `tcp && udp` rỗng nên hai giao thức riêng vẫn khai chung port được — đúng thứ Draytek cho
 * phép và ràng buộc cố ý chừa. `tcp && both` khác rỗng nên bị chặn, ở mọi mức đồng thời,
 * không cần khóa nào và không ai phải nhớ gì.
 *
 * Phép kiểm trong service KHÔNG bị gỡ: nó vẫn là đường cho câu lỗi tử tế (nói rõ đụng rule
 * nào). Nó chỉ thôi làm TRỌNG TÀI DUY NHẤT.
 *
 * ===== VÌ SAO Ở TẦNG NÀY =====
 *
 * Câu hỏi là "hai transaction thật có cùng ghi lọt không". Chỉ hai kết nối thật mới hỏi được;
 * bài đơn vị không có ràng buộc DB để mà va vào.
 */

const TEST_TIMEOUT = 120_000;

/** Cặp giao thức, và sổ NAT có được phép chứa cả hai trên cùng một port không. */
const PROTOCOL_PAIRS: [string, string, boolean][] = [
  ['tcp', 'both', false],
  ['both', 'tcp', false],
  ['udp', 'both', false],
  ['both', 'udp', false],
  ['both', 'both', false],
  ['tcp', 'tcp', false],
  // Vế phải giữ: Draytek khai riêng TCP và UDP cùng port là việc hợp lệ.
  ['tcp', 'udp', true],
  ['udp', 'tcp', true],
];

describe('Sổ NAT — trọng tài chồng port nằm ở DB, không ở một phép đọc ngoài transaction', () => {
  let scratch: ScratchDb;
  let second: Pool;
  let deviceId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_nat_overlap');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    second = new Pool({ connectionString: testDbUrl(scratch.name) });
    second.on('error', () => undefined);

    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('Router') RETURNING id`,
    );
    const device = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id, status)
       VALUES ('RT-NAT-01', 'Draytek kiem trong tai', $1, 'in_use') RETURNING id`,
      [type.rows[0].id],
    );
    deviceId = device.rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await second?.end();
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await scratch.pool.query('DELETE FROM nat_rule');
  });

  function insertRule(client: Pool | PoolClient, protocol: string, port: number): Promise<unknown> {
    return client.query(
      `INSERT INTO nat_rule
         (device_id, protocol, external_from, external_to, internal_ip, internal_port,
          used_by, reason, created_by)
       VALUES ($1, $2, $3, $3, '172.16.10.5', 80, 'Phong IT', 'Kiem trong tai', 'test@pmh.com.vn')`,
      [deviceId, protocol, port],
    );
  }

  it.each(PROTOCOL_PAIRS)(
    '%s rồi %s trên cùng một port, GHI TUẦN TỰ → cùng sổ được: %s',
    async (first, secondProtocol, allowed) => {
      await insertRule(scratch.pool, first, 8080);
      const outcome = await insertRule(scratch.pool, secondProtocol, 8080).then(
        () => null,
        (error: unknown) => (error as { code?: string }).code ?? 'unknown',
      );
      // `23P01` = exclusion_violation. Service dịch nó thành NAT_PORT_OVERLAP (409).
      expect(outcome).toBe(allowed ? null : '23P01');
    },
    TEST_TIMEOUT,
  );

  it(
    'HAI TRANSACTION SONG SONG cùng khai TCP/8080 và BOTH/8080 → chỉ một dòng sống sót',
    async () => {
      const clientA = await scratch.pool.connect();
      const clientB = await second.connect();
      try {
        await clientA.query('BEGIN');
        await clientB.query('BEGIN');

        /*
         * Đây là khe hở nguyên bản: cả hai đọc sổ TRƯỚC khi bên kia ghi, nên phép kiểm trong
         * service — chạy ngoài transaction — cho CẢ HAI đi qua. Bài này bỏ qua service và bắn
         * thẳng vào DB, đúng thứ sẽ xảy ra sau khi cả hai đã qua cửa ấy.
         */
        await insertRule(clientA, 'tcp', 8080);

        const blocked = insertRule(clientB, 'both', 8080).then(
          () => null,
          (error: unknown) => (error as { code?: string }).code ?? 'unknown',
        );

        await clientA.query('COMMIT');
        const outcome = await blocked;
        await clientB.query('ROLLBACK');

        expect(outcome).toBe('23P01');
      } finally {
        clientA.release();
        clientB.release();
      }

      const { rows } = await scratch.pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM nat_rule WHERE voided_at IS NULL`,
      );
      expect(Number(rows[0].n)).toBe(1);
    },
    TEST_TIMEOUT,
  );

  it(
    'rule ĐÃ GỠ không chiếm chỗ — port mở lại được sau khi gỡ, kể cả đổi giao thức',
    async () => {
      await insertRule(scratch.pool, 'both', 9090);
      await scratch.pool.query(
        `UPDATE nat_rule SET voided_at = now(), voided_by = 'test@pmh.com.vn',
                             void_reason = 'Khong dung nua'`,
      );
      // `WHERE (voided_at IS NULL)` của EXCLUDE phải còn nguyên sau khi đổi ràng buộc.
      await expect(insertRule(scratch.pool, 'tcp', 9090)).resolves.toBeDefined();
    },
    TEST_TIMEOUT,
  );

  it(
    'chồng MỘT PHẦN giữa hai dải cũng bị bắt, không chỉ trùng khít',
    async () => {
      await scratch.pool.query(
        `INSERT INTO nat_rule
           (device_id, protocol, external_from, external_to, internal_ip, internal_port,
            used_by, reason, created_by)
         VALUES ($1, 'tcp', 8000, 8010, '172.16.10.5', 80, 'Phong IT', 'Dai camera', 'test@pmh.com.vn')`,
        [deviceId],
      );
      const outcome = await scratch.pool
        .query(
          `INSERT INTO nat_rule
             (device_id, protocol, external_from, external_to, internal_ip, internal_port,
              used_by, reason, created_by)
           VALUES ($1, 'both', 8005, 8020, '172.16.10.6', 80, 'Phong IT', 'Dai khac', 'test@pmh.com.vn')`,
          [deviceId],
        )
        .then(
          () => null,
          (error: unknown) => (error as { code?: string }).code ?? 'unknown',
        );
      expect(outcome).toBe('23P01');
    },
    TEST_TIMEOUT,
  );
});
