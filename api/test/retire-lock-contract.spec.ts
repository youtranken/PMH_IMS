import { Pool, type PoolClient } from 'pg';
import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, testDbUrl, waitForLock, type ScratchDb } from './db';

/**
 * THANH LÝ MỘT MÁY PHẢI LOẠI TRỪ ĐƯỢC LƯỢT GẮN TÀI SẢN ĐANG CHẠY SONG SONG.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `DevicesService.setStatus` đọc hồ sơ và đếm `holdings` NGOÀI transaction rồi mới mở
 * transaction để ghi. `DevicesApiService.assertUsable` — cửa mà ipam/software hỏi trước khi
 * gắn IP, ghế license, rule NAT, đường truyền vào một máy — cũng đọc trên pool rồi buông.
 *
 * Hai đường đó không hề thấy nhau, nên trình tự này lọt mà không cần lỗi gì:
 *
 *     T1 (thanh lý) đếm holdings → rỗng      T2 (cấp IP) hỏi assertUsable → "còn dùng được"
 *     T1 BEGIN; UPDATE status='retired'      T2 BEGIN; INSERT ip_address(device_id = máy đó)
 *     T1 COMMIT                              T2 COMMIT
 *
 * Kết quả: một máy `retired` đang giữ một địa chỉ IP, và KHÔNG bên nào gặp lỗi. Đúng cái
 * trạng thái mà `DeviceRetirementRegistry` sinh ra để loại trừ — chú thích đầu file đó viết
 * "hoặc máy được thanh lý và mọi thứ nó giữ được trả lại, hoặc không có gì xảy ra". Câu ấy
 * đúng với SỰ CỐ và sai với ĐỒNG THỜI.
 *
 * Bản vá 11/09 bắt cặp `FOR UPDATE` (lượt thanh lý) với `FOR SHARE` (lượt gắn tài sản) trên
 * cùng hàng `device`.
 *
 * ===== VÌ SAO Ở TẦNG NÀY =====
 *
 * Thứ đang kiểm là hành vi của Postgres giữa HAI kết nối thật: `FOR SHARE` có chặn `FOR
 * UPDATE` không, và hai `FOR SHARE` có chặn nhau không. Unit test không có transaction để mà
 * đua (và CLAUDE.md cấm mock drizzle). E2E cũng không: vài request qua một `APIRequestContext`
 * không chồng lên nhau đủ để mở khe hở — chuyện đó đã đo ở `ip-restore-guard.spec.ts` và bài
 * E2E tương ứng đã bị bỏ vì nó xanh cả trên code chưa vá.
 *
 * ===== GIỚI HẠN, NÓI THẲNG =====
 *
 * Bài này khóa hợp đồng của CÂU SQL, không chứng minh service phát ra đúng câu đó — cùng giới
 * hạn đã ghi cho `subnet-cidr-race` và `totp-replay-cas`. Vế còn lại do E2E giữ
 * (`e2e/tests/retire-cleanup.spec.ts` và `e2e/tests/retired-device-guard.spec.ts`) và do
 * `device-retirement.registry.spec.ts` giữ ở phía "đủ người dọn hay chưa".
 *
 * Dòng trên trước 26/09 trỏ vào `e2e/tests/thanh-ly-du-no.spec.ts` — một file CHƯA TỪNG tồn
 * tại trong repo, kể cả trong lịch sử git.
 */

const TEST_TIMEOUT = 120_000;

describe('Hợp đồng khóa của lượt thanh lý thiết bị', () => {
  let scratch: ScratchDb;
  let pool: Pool;
  let deviceId: string;
  let subnetId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_retire_lock');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    pool = scratch.pool;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await pool.query('DELETE FROM nat_rule');
    await pool.query('DELETE FROM ip_address');
    await pool.query('DELETE FROM subnet');
    await pool.query('DELETE FROM device_history');
    await pool.query('DELETE FROM device');
    await pool.query('DELETE FROM device_type');

    const type = await pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('Switch') RETURNING id`,
    );
    const device = await pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id, status)
       VALUES ('SW-KHOA-01', 'Switch kiểm khóa', $1, 'in_use') RETURNING id`,
      [type.rows[0].id],
    );
    deviceId = device.rows[0].id;

    const subnet = await pool.query<{ id: string }>(
      `INSERT INTO subnet (name, cidr, created_by) VALUES ('Dải kiểm khóa', '10.9.0.0/24', 'test')
       RETURNING id`,
    );
    subnetId = subnet.rows[0].id;
  });

  /** Một kết nối riêng, tách hẳn khỏi pool — hai bên phải là hai session Postgres khác nhau. */
  async function connection() {
    const p = new Pool({ connectionString: testDbUrl(scratch.name), max: 1 });
    p.on('error', () => undefined);
    const client = await p.connect();
    return {
      client,
      close: async () => {
        client.release();
        await p.end();
      },
    };
  }

  /** Đúng câu mà `DevicesService.setStatus` chạy đầu transaction sau bản vá. */
  function lockForRetire(client: PoolClient) {
    return client.query('SELECT status FROM device WHERE id = $1 FOR UPDATE', [deviceId]);
  }

  /** Đúng câu mà `DevicesService.assertUsableWithin` chạy đầu mỗi lượt ghi tài sản. */
  function lockForAttach(client: PoolClient) {
    return client.query('SELECT status FROM device WHERE id = $1 FOR SHARE', [deviceId]);
  }

  function attachIp(client: PoolClient, address: string) {
    return client.query(
      `INSERT INTO ip_address (subnet_id, address, device_id, status, assigned_by)
       VALUES ($1, $2, $3, 'assigned', 'test')`,
      [subnetId, address, deviceId],
    );
  }

  function holdings(client: PoolClient | Pool) {
    return client
      .query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ip_address
          WHERE device_id = $1 AND voided_at IS NULL`,
        [deviceId],
      )
      .then((r) => r.rows[0].n);
  }

  it(
    'HÌNH DẠNG CŨ (không khóa gì): thanh lý và cấp IP cùng thắng — máy đã thanh lý vẫn giữ IP',
    async () => {
      const retire = await connection();
      const attach = await connection();
      try {
        await retire.client.query('BEGIN');
        await attach.client.query('BEGIN');

        // Cả hai đọc trạng thái, KHÔNG khóa — đúng bản trước 11/09.
        const seenByRetire = await retire.client.query<{ status: string }>(
          'SELECT status FROM device WHERE id = $1',
          [deviceId],
        );
        const seenByAttach = await attach.client.query<{ status: string }>(
          'SELECT status FROM device WHERE id = $1',
          [deviceId],
        );
        expect(seenByRetire.rows[0].status).toBe('in_use');
        expect(seenByAttach.rows[0].status).toBe('in_use'); // "còn dùng được" — và nó sai ngay sau đây

        // Lượt thanh lý đếm tài sản: rỗng, nên nó đi tiếp.
        expect(await holdings(retire.client)).toBe(0);

        await attachIp(attach.client, '10.9.0.5');
        await retire.client.query(`UPDATE device SET status = 'retired' WHERE id = $1`, [deviceId]);
        await attach.client.query('COMMIT');
        await retire.client.query('COMMIT');

        /*
         * ĐÂY LÀ LỖ, ĐO ĐƯỢC: máy đã ra khỏi sổ mà vẫn đang giữ một địa chỉ IP, và không câu
         * lệnh nào trong cả hai lượt báo lỗi. Bài này CỐ Ý khóa lại hình dạng cũ để bản vá có
         * cái mà đối chiếu — xóa nó đi thì không còn gì chứng minh hai bài dưới đo đúng thứ
         * cần đo.
         */
        const after = await pool.query<{ status: string }>(
          'SELECT status FROM device WHERE id = $1',
          [deviceId],
        );
        expect(after.rows[0].status).toBe('retired');
        expect(await holdings(pool)).toBe(1);
      } finally {
        await retire.close();
        await attach.close();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'LƯỢT GẮN ĐI TRƯỚC: thanh lý phải ĐỨNG LẠI, rồi đếm được tài sản vừa gắn',
    async () => {
      const attach = await connection();
      const retire = await connection();
      try {
        await attach.client.query('BEGIN');
        await lockForAttach(attach.client);
        await attachIp(attach.client, '10.9.0.6');

        await retire.client.query('BEGIN');
        const blocked = lockForRetire(retire.client);
        let settled = false;
        void blocked.then(
          () => (settled = true),
          () => (settled = true),
        );
        await waitForLock(pool);
        // Đứng lại ở đây là điều kiện SỐNG CÒN của bài: chạy tiếp nghĩa là lỗ cũ còn nguyên.
        expect(settled).toBe(false);

        await attach.client.query('COMMIT');
        await blocked;

        /*
         * CÂU CHỐT. Bản cũ đếm trước và ngoài transaction nên ra 0 rồi thanh lý; nay nó chờ
         * xong mới đếm, và thấy đúng địa chỉ vừa được cấp → `DEVICE_HAS_HOLDINGS`.
         */
        expect(await holdings(retire.client)).toBe(1);
        await retire.client.query('ROLLBACK');
      } finally {
        await attach.close();
        await retire.close();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'THANH LÝ ĐI TRƯỚC: lượt gắn phải ĐỨNG LẠI, rồi đọc ra trạng thái MỚI',
    async () => {
      const retire = await connection();
      const attach = await connection();
      try {
        await retire.client.query('BEGIN');
        await lockForRetire(retire.client);
        await retire.client.query(`UPDATE device SET status = 'retired' WHERE id = $1`, [deviceId]);

        await attach.client.query('BEGIN');
        const blocked = lockForAttach(attach.client);
        let settled = false;
        void blocked.then(
          () => (settled = true),
          () => (settled = true),
        );
        await waitForLock(pool);
        expect(settled).toBe(false);

        await retire.client.query('COMMIT');

        /*
         * Mở khóa xong, `FOR SHARE` đọc LẠI hàng (EvalPlanQual) chứ không trả ảnh chụp cũ —
         * đó là lý do `assertUsableWithin` kiểm `status` SAU khi khóa chứ không trước.
         */
        const seen = await blocked;
        expect(seen.rows[0].status).toBe('retired');
        await attach.client.query('ROLLBACK');
      } finally {
        await retire.close();
        await attach.close();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'VẾ ĐỐI CHỨNG: hai lượt GẮN cùng lúc KHÔNG được chặn nhau',
    async () => {
      const a = await connection();
      const b = await connection();
      try {
        await a.client.query('BEGIN');
        await lockForAttach(a.client);

        await b.client.query('BEGIN');
        /*
         * `FOR SHARE` chia sẻ được, nên câu này phải chạy NGAY. Không có bài này thì
         * `FOR UPDATE` ở cả hai chỗ cũng xanh ba bài trên — và cả phòng IT sẽ xếp hàng sau
         * nhau mỗi lần cấp IP cho cùng một switch, không vì lý do gì.
         */
        await expect(lockForAttach(b.client)).resolves.toBeDefined();

        await a.client.query('ROLLBACK');
        await b.client.query('ROLLBACK');
      } finally {
        await a.close();
        await b.close();
      }
    },
    TEST_TIMEOUT,
  );

  /**
   * GỠ RULE NAT — cùng một lớp lỗi, chỗ khác.
   *
   * `NatRuleService.voidWithin` đọc `requireAliveWithin` rồi ghi VÔ ĐIỀU KIỆN. Trạng thái
   * cuối vẫn đúng (rule bị gỡ), nhưng SỔ thì hỏng: hai dòng "đã gỡ" cho một lần gỡ, hai người
   * và hai lý do, còn hàng thật mang lý do của người bấm sau.
   */
  describe('Gỡ rule NAT phải loại trừ được lượt song song', () => {
    let ruleId: string;

    beforeEach(async () => {
      const rule = await pool.query<{ id: string }>(
        `INSERT INTO nat_rule
           (device_id, protocol, external_from, external_to, internal_ip, internal_port,
            used_by, reason, created_by)
         VALUES ($1, 'tcp', 8080, 8080, '10.9.0.20', 80, 'Camera tầng 3', 'Xem camera', 'test')
         RETURNING id`,
        [deviceId],
      );
      ruleId = rule.rows[0].id;
    });

    function voidUnconditional(client: PoolClient, actor: string, reason: string) {
      return client.query(
        `UPDATE nat_rule SET voided_at = now(), voided_by = $2, void_reason = $3
          WHERE id = $1`,
        [ruleId, actor, reason],
      );
    }

    function voidWithPredicate(client: PoolClient, actor: string, reason: string) {
      return client.query(
        `UPDATE nat_rule SET voided_at = now(), voided_by = $2, void_reason = $3
          WHERE id = $1 AND voided_at IS NULL`,
        [ruleId, actor, reason],
      );
    }

    it(
      'câu ghi VÔ ĐIỀU KIỆN: cả hai lượt cùng thắng, lý do của người trước bị đè',
      async () => {
        const first = await connection();
        const second = await connection();
        try {
          await first.client.query('BEGIN');
          expect((await voidUnconditional(first.client, 'an@pmh.com.vn', 'Camera đã tháo')).rowCount).toBe(1);
          await first.client.query('COMMIT');

          await second.client.query('BEGIN');
          // Không vị từ nên nó khớp hàng ĐÃ GỠ và ghi đè — 1 dòng, không phải 0.
          expect((await voidUnconditional(second.client, 'binh@pmh.com.vn', 'Dọn dẹp')).rowCount).toBe(1);
          await second.client.query('COMMIT');

          const row = await pool.query<{ voided_by: string; void_reason: string }>(
            'SELECT voided_by, void_reason FROM nat_rule WHERE id = $1',
            [ruleId],
          );
          // Lý do THẬT ("Camera đã tháo") đã mất, và sổ không còn cách nào biết điều đó.
          expect(row.rows[0].voided_by).toBe('binh@pmh.com.vn');
          expect(row.rows[0].void_reason).toBe('Dọn dẹp');
        } finally {
          await first.close();
          await second.close();
        }
      },
      TEST_TIMEOUT,
    );

    it(
      'câu ghi CÓ VỊ TỪ: lượt thứ hai khớp 0 dòng → `requireCas` ném 409, sổ giữ nguyên',
      async () => {
        const first = await connection();
        const second = await connection();
        try {
          await first.client.query('BEGIN');
          expect((await voidWithPredicate(first.client, 'an@pmh.com.vn', 'Camera đã tháo')).rowCount).toBe(1);
          await first.client.query('COMMIT');

          await second.client.query('BEGIN');
          expect((await voidWithPredicate(second.client, 'binh@pmh.com.vn', 'Dọn dẹp')).rowCount).toBe(0);
          await second.client.query('ROLLBACK');

          const row = await pool.query<{ voided_by: string; void_reason: string }>(
            'SELECT voided_by, void_reason FROM nat_rule WHERE id = $1',
            [ruleId],
          );
          expect(row.rows[0].voided_by).toBe('an@pmh.com.vn');
          expect(row.rows[0].void_reason).toBe('Camera đã tháo');
        } finally {
          await first.close();
          await second.close();
        }
      },
      TEST_TIMEOUT,
    );

    it(
      'VẾ ĐỐI CHỨNG: rule còn sống thì vị từ KHÔNG được chặn lượt gỡ đầu tiên',
      async () => {
        const only = await connection();
        try {
          await only.client.query('BEGIN');
          expect((await voidWithPredicate(only.client, 'an@pmh.com.vn', 'Camera đã tháo')).rowCount).toBe(1);
          await only.client.query('COMMIT');
        } finally {
          await only.close();
        }
      },
      TEST_TIMEOUT,
    );
  });
});
