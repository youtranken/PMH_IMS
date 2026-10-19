import { runMigrations } from '../src/database/migration-runner';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { DevicesApiService } from '../src/modules/devices/devices.api';
import { DevicePortsService } from '../src/modules/devices/device-ports.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DiagramsService } from '../src/modules/diagrams/diagrams.service';
import type { IpamApiService } from '../src/modules/ipam/ipam.api';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb, waitForLock } from './db';
import { noPhotos } from './device-photos-stub';

/**
 * Chuyển nút cây sơ đồ: A chuyển X vào dưới Y, B cùng lúc chuyển Y vào dưới X. Bước kiểm vòng
 * (`descendantIds`) chạy ngoài transaction nên cả hai cùng qua, và cây thành một vòng: X và Y biến
 * khỏi cây (không còn gốc nào dẫn tới), đệ quy theo cha chạy mãi. Kết nối thứ ba khoá sẵn hai hàng
 * để hai lượt cùng qua bước kiểm trước khi lượt nào commit.
 */

const TEST_TIMEOUT = 180_000;
const SA = { email: 'e2e-move-sa@qa.test', role: 'sa' as const, fullName: 'E2E SA chuyển' };

const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;

describe('chuyển nút cây sơ đồ chéo nhau không tạo vòng', () => {
  let scratch: ScratchDb;
  let service: DiagramsService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_diagram_move_cycle');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const audit = new AuditWriterService(db);
    const catalog = new CatalogApiService(new CatalogService(db, audit));
    const devicesService = new DevicesService(db, catalog, audit, noRetirement, new DeviceSearchRegistry());
    const devices = new DevicesApiService(devicesService, new DevicePortsService(db, devicesService), noPhotos);
    const ipam = { heldAddressesOf: (ids: string[]) => Promise.resolve(new Map(ids.map((id) => [id, []]))) } as unknown as IpamApiService;
    service = new DiagramsService(db, audit, new SystemConfigService(db), catalog, devices, ipam, new UsersApiService(new UsersService(db)));
    await scratch.pool.query(`INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, 'x')`, [SA.email, SA.fullName, SA.role]);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('một lượt thành công, lượt kia nhận 400 DIAGRAM_MOVE_CYCLE; cây không có vòng', async () => {
    const x = (await service.create(SA.email, { name: 'E2E X', nodeType: 'company' })).id;
    const y = (await service.create(SA.email, { name: 'E2E Y', nodeType: 'company' })).id;
    /*
     * Kết nối thứ ba giữ FOR NO KEY UPDATE trên X: lượt A (đổi cha của X) đứng chờ SAU khi đã kiểm
     * vòng, còn bước kiểm khoá ngoại của lượt B (khoá KEY SHARE trên X) vẫn đi được. Trình tự gây
     * lỗi: A kiểm → B kiểm, ghi, commit → A ghi. Bản đúng phải bắt B chờ A (khoá cả cây) hoặc kiểm
     * lại trong transaction.
     */
    const blocker = await scratch.pool.connect();
    let results: PromiseSettledResult<unknown>[];
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT 1 FROM diagram WHERE id = $1 FOR NO KEY UPDATE', [x]);
      const first = service.update(SA, x, { parentId: y });
      void first.catch(() => undefined);
      await waitForLock(scratch.pool);
      let secondDone = false;
      const second = service.update(SA, y, { parentId: x }).finally(() => (secondDone = true));
      void second.catch(() => undefined);
      // B hoặc chạy xong (bản lỗi), hoặc đứng chờ A (bản đúng) — chờ một trong hai.
      for (let i = 0; i < 200 && !secondDone; i += 1) {
        const { rows } = await scratch.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`,
        );
        if (rows[0].n >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await blocker.query('COMMIT');
      results = await Promise.allSettled([first, second]);
    } finally {
      blocker.release();
    }
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 400, response: { code: 'DIAGRAM_MOVE_CYCLE' } });
    const { rows } = await scratch.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM diagram a JOIN diagram b ON a.parent_id = b.id AND b.parent_id = a.id`,
    );
    expect(rows[0].n).toBe(0);
  }, TEST_TIMEOUT);
});
