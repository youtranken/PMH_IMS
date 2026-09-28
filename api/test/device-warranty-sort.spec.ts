import { runMigrations } from '../src/database/migration-runner';
import { deviceTable } from '../src/modules/devices/devices.schema';
import { deviceOrderBy } from '../src/modules/devices/devices.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Sắp theo Bảo hành là để tìm máy SẮP HẾT HẠN. Máy đã thanh lý ("Không tính hạn") và máy chưa
 * khai hạn không trả lời câu hỏi đó, nên chúng luôn nằm CUỐI — bất kể chiều sắp. Trước đây
 * sắp tăng dần đưa máy đã thanh lý lên đầu và máy chưa khai hạn nằm lẫn giữa danh sách.
 */

const TEST_TIMEOUT = 120_000;

describe('Danh sách thiết bị — sắp theo Bảo hành', () => {
  let scratch: ScratchDb;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_warranty_sort');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('Loai E2E sap') RETURNING id`,
    );
    const type = rows[0].id;
    const add = (code: string, end: string | null, status = 'in_use') =>
      scratch.pool.query(
        `INSERT INTO device (code, name, device_type_id, warranty_end, status)
         VALUES ($1::text, $1::text, $2, $3, $4)`,
        [code, type, end, status],
      );
    await add('E2E-W-OLD-RETIRED', '2020-01-01', 'retired');
    await add('E2E-W-2025', '2025-06-01');
    await add('E2E-W-NULL', null);
    await add('E2E-W-2027', '2027-06-01', 'broken');
    await add('E2E-W-NULL-RETIRED', null, 'retired');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function order(dir: 'asc' | 'desc'): Promise<string[]> {
    const rows = await scratch.db
      .select({ code: deviceTable.code })
      .from(deviceTable)
      .orderBy(...deviceOrderBy({ key: 'warrantyEnd', dir }));
    return rows.map((r) => r.code);
  }

  it(
    'tăng dần: máy còn tính hạn theo ngày, rồi máy chưa khai hạn, máy đã thanh lý cuối cùng',
    async () => {
      expect(await order('asc')).toEqual([
        'E2E-W-2025',
        'E2E-W-2027',
        'E2E-W-NULL',
        'E2E-W-OLD-RETIRED',
        'E2E-W-NULL-RETIRED',
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'giảm dần: chưa khai hạn và đã thanh lý VẪN ở cuối, không nhảy lên đầu',
    async () => {
      expect(await order('desc')).toEqual([
        'E2E-W-2027',
        'E2E-W-2025',
        'E2E-W-NULL',
        'E2E-W-OLD-RETIRED',
        'E2E-W-NULL-RETIRED',
      ]);
    },
    TEST_TIMEOUT,
  );
});
