import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../src/database/migration-runner';
import type { Database } from '../src/database/database.module';
import { LicenseAssignmentService } from '../src/modules/software/license-assignment.service';
import type { SoftwareService } from '../src/modules/software/software.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import { createScratchDb, migrationsDir, testDbUrl, waitForLock, type ScratchDb } from './db';

/**
 * TRẦN SEAT PHẢI ĐỌC TỪ HÀNG ĐÃ KHÓA, KHÔNG PHẢI TỪ ẢNH CHỤP TRƯỚC KHI KHÓA.
 *
 * ===== LỖ ĐANG VÁ (A-05 của rà soát 19/09) =====
 *
 * `assign()` làm đúng hai việc theo đúng thứ tự sai:
 *
 *   1. `this.software.findOne(softwareId)` — chạy trên POOL, ngoài mọi transaction. Đây là
 *      nơi `seatTotal` được đọc.
 *   2. mở transaction, `SELECT id FROM software … FOR UPDATE` — khóa hàng, rồi đếm `used`
 *      bên trong.
 *
 * Bước 2 xếp hàng đúng luật, và chú thích dài ngay trên nó giải thích rất kỹ vì sao phải xếp
 * hàng. Nhưng nó chỉ `select({ id })`: hàng được KHÓA mà không được ĐỌC LẠI. Phép so ở dưới
 * vẫn dùng `software.seatTotal` — con số của bước 1.
 *
 * Nên giữa hai bước, một lượt hạ trần (`PATCH /software/:id {seatTotal}`, hoặc lượt import
 * sửa hồ sơ) chen vào được: lượt gán đứng chờ khóa, đọc lại `used` cho đúng, rồi đem con số
 * đúng ấy đi so với một cái trần ĐÃ KHÔNG CÒN. Kết quả là ghế thứ 2 vào một license 1 ghế mà
 * KHÔNG ai phải khai `overSeatReason` — đúng thứ AC 3.2 dựng ra để chặn, và vượt seat là
 * chuyện pháp lý với nhà cung cấp chứ không phải một cảnh báo cho vui.
 *
 * Khóa đúng chỗ nhưng đọc sai nguồn thì cái khóa chỉ còn là nghi lễ.
 *
 * ===== VÌ SAO Ở TẦNG NÀY =====
 *
 * Thứ phải dựng lại là một lượt ghi ĐANG GIỮ KHÓA trong khi lượt kia chờ. Không có transaction
 * thật thì không có khóa thật; cấm mock drizzle, và E2E thì hai request tuần tự không bao giờ
 * chồng lên nhau đúng khe hở này (cùng kết luận đã ghi ở `ip-restore-guard.spec.ts`).
 *
 * Bài này KHÔNG đua: nó dàn cảnh tất định bằng một kết nối thứ hai giữ khóa, nên không chập
 * chờn. `waitForLock` là chỗ chứng minh lượt gán THẬT SỰ đứng chờ chứ không phải chỉ chậm.
 */

const TEST_TIMEOUT = 120_000;

/** Trần lúc lượt gán CHỤP ẢNH, và trần lúc nó THẬT SỰ ghi. Khác nhau là toàn bộ câu chuyện. */
const SEATS_AT_SNAPSHOT = 5;
const SEATS_AFTER_CUT = 1;

describe('Gán license — trần seat bị hạ trong lúc lượt gán đang chờ khóa', () => {
  let scratch: ScratchDb;
  let holder: Pool;
  let holderClient: PoolClient | null = null;
  let service: LicenseAssignmentService;
  let softwareId: string;
  let secondDeviceId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_seat_race');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    holder = new Pool({ connectionString: testDbUrl(scratch.name) });
    holder.on('error', () => undefined);

    const db = drizzle(scratch.pool) as unknown as Database;

    /*
     * `SoftwareService` giả — CHỈ hai cửa mà `assign` gọi tới, và cửa đọc thì đọc HÀNG THẬT.
     *
     * Không dựng bản thật vì nó kéo theo catalog + audit + expiry, ba thứ không liên quan gì
     * tới câu hỏi ở đây. Nhưng `findOne` phải đọc DB thật chứ không trả hằng số: điều đang
     * kiểm là "con số ấy đến từ đâu và đọc lúc nào", nên nếu chính bài kiểm bịa ra con số thì
     * nó không còn hỏi gì nữa.
     */
    const software = {
      findOne: async (id: string) => {
        const { rows } = await scratch.pool.query<{
          kind: string;
          license_model: string;
          seat_total: number | null;
        }>(`SELECT kind, license_model, seat_total FROM software WHERE id = $1`, [id]);
        return {
          id,
          kind: rows[0].kind,
          licenseModel: rows[0].license_model,
          seatTotal: rows[0].seat_total,
        };
      },
      recordWithin: () => Promise.resolve(),
    } as unknown as SoftwareService;

    const devices = {
      assertUsableWithin: () => Promise.resolve(),
      getByIds: () => Promise.resolve(new Map()),
    } as unknown as DevicesApiService;

    service = new LicenseAssignmentService(db, software, devices);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    holderClient?.release();
    await holder?.end();
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await scratch.pool.query('DELETE FROM license_assignment');
    await scratch.pool.query('DELETE FROM software_history');
    await scratch.pool.query('DELETE FROM software');
    await scratch.pool.query('DELETE FROM device');
    await scratch.pool.query('DELETE FROM device_type');

    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('PC') RETURNING id`,
    );
    const seeded = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id)
       VALUES ('PC-SEAT-01', 'May mot', $1), ('PC-SEAT-02', 'May hai', $1)
       RETURNING id`,
      [type.rows[0].id],
    );
    secondDeviceId = seeded.rows[1].id;

    const software = await scratch.pool.query<{ id: string }>(
      `INSERT INTO software (code, name, kind, license_model, seat_total)
       VALUES ('LIC-SEAT', 'Bo go tieng Viet', 'license', 'perpetual', $1)
       RETURNING id`,
      [SEATS_AT_SNAPSHOT],
    );
    softwareId = software.rows[0].id;

    // Ghế đầu tiên đã dùng. Sau khi hạ trần xuống 1 thì license ĐÃ ĐẦY.
    await scratch.pool.query(
      `INSERT INTO license_assignment (software_id, device_id, assigned_by)
       VALUES ($1, $2, 'seed@pmh.com.vn')`,
      [softwareId, seeded.rows[0].id],
    );
  });

  /** Giữ hàng `software` và hạ trần, nhưng CHƯA commit — lượt gán sẽ phải đứng chờ. */
  async function holdAndCutSeats(): Promise<void> {
    holderClient = await holder.connect();
    await holderClient.query('BEGIN');
    await holderClient.query(`SELECT id FROM software WHERE id = $1 FOR UPDATE`, [softwareId]);
    await holderClient.query(`UPDATE software SET seat_total = $1 WHERE id = $2`, [
      SEATS_AFTER_CUT,
      softwareId,
    ]);
  }

  /** Nhả khóa ra cho lượt gán đi tiếp. */
  async function releaseHold(): Promise<void> {
    if (!holderClient) throw new Error('Chưa ai giữ khóa — bài kiểm dàn cảnh sai.');
    await holderClient.query('COMMIT');
    holderClient.release();
    holderClient = null;
  }

  it(
    'trần hạ 5→1 giữa chừng: ghế thứ hai phải đòi lý do vượt seat, không lọt im lặng',
    async () => {
      await holdAndCutSeats();

      const assigning = service
        .assign('nguoi.gan@pmh.com.vn', softwareId, { deviceId: secondDeviceId })
        .then(
          () => ({ threw: false, code: null as string | null }),
          (error: unknown) => ({
            threw: true,
            code: (error as { response?: { code?: string } }).response?.code ?? null,
          }),
        );

      // Chứng minh lượt gán THẬT SỰ đứng chờ khóa — không phải chỉ đang chậm.
      await waitForLock(scratch.pool);
      await releaseHold();

      const outcome = await assigning;

      // Trần lúc ghi là 1, đang dùng 1 ⇒ đầy. Không có lý do thì phải bị chặn.
      expect(outcome.code).toBe('SEAT_LIMIT_REACHED');
      expect(outcome.threw).toBe(true);

      const { rows } = await scratch.pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM license_assignment
          WHERE software_id = $1 AND released_at IS NULL`,
        [softwareId],
      );
      expect(Number(rows[0].n)).toBe(1);
    },
    TEST_TIMEOUT,
  );

  it(
    'trần hạ 5→1 giữa chừng, CÓ khai lý do: vẫn ghi được, và cảnh báo nói đúng trần mới',
    async () => {
      await holdAndCutSeats();

      const assigning = service.assign('nguoi.gan@pmh.com.vn', softwareId, {
        deviceId: secondDeviceId,
        overSeatReason: 'Sep duyet mua them ghe tuan sau',
      });

      await waitForLock(scratch.pool);
      await releaseHold();

      const result = await assigning;

      // Con số trong câu cảnh báo cũng phải là trần MỚI: "2/1", không phải "2/5".
      expect(result.warnings.join(' ')).toContain(`2/${SEATS_AFTER_CUT}`);
    },
    TEST_TIMEOUT,
  );
});
