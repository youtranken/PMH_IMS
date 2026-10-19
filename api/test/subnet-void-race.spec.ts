import { runMigrations } from '../src/database/migration-runner';
import { SubnetService } from '../src/modules/ipam/subnet.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb, waitForLock } from './db';

/**
 * Bấm "Ngừng dùng" một dải hai lần chồng nhau (hai tab, bấm đúp, mạng chậm rồi bấm lại).
 *
 * `restore` nhận ra IP "tắt cùng dải" bằng `ip_address.voided_at = subnet.voided_at`. Nếu lượt
 * thứ hai đi qua được thì nó ghi đè `subnet.voided_at` bằng mốc của nó, trong khi các IP mang mốc
 * của lượt đầu — bật lại dải xong không IP nào sống lại, phải chữa bằng SQL tay. Hai lượt phải là
 * hai kết nối thật chạy song song: tuần tự thì lượt sau tự bị `requireAlive` chặn.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'rv01@test';

describe('ngừng dùng dải hai lần chồng nhau', () => {
  let scratch: ScratchDb;
  let subnets: SubnetService;
  let round = 0;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_subnet_void_race');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    subnets = new SubnetService(
      scratch.db,
      audit,
      {} as CatalogApiService,
      new SystemConfigService(scratch.db),
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function subnetWithAddresses(count: number): Promise<string> {
    round += 1;
    const subnet = await subnets.create(ACTOR, { name: `Dai E2E void ${round}`, cidr: `10.61.${round}.0/24` });
    for (let i = 1; i <= count; i += 1) {
      await scratch.pool.query(
        `INSERT INTO ip_address (subnet_id, address, assigned_by) VALUES ($1, $2, $3)`,
        [subnet.id, `10.61.${round}.${i}`, ACTOR],
      );
    }
    return subnet.id;
  }

  async function aliveAddresses(subnetId: string): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ip_address WHERE subnet_id = $1 AND voided_at IS NULL`,
      [subnetId],
    );
    return rows[0].n;
  }

  it(
    'chỉ một lượt thắng, lượt kia nhận lỗi rõ ràng; bật lại dải thì mọi IP sống lại',
    async () => {
      const id = await subnetWithAddresses(5);

      /*
       * Gọi song song trần thì lượt sau thường tới muộn (phải mở kết nối mới) và bị kiểm "còn
       * sống" chặn — khe hở có thật nhưng hẹp. Một kết nối thứ ba khoá sẵn các hàng IP để cả hai
       * lượt cùng vào cuộc trước khi lượt nào commit, đúng trình tự gây lỗi.
       */
      const blocker = await scratch.pool.connect();
      let results: PromiseSettledResult<void>[];
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT 1 FROM ip_address WHERE subnet_id = $1 FOR UPDATE', [id]);
        const first = subnets.voidSubnet(ACTOR, id, 'lan 1');
        void first.catch(() => undefined);
        await waitForLock(scratch.pool);
        const second = subnets.voidSubnet(ACTOR, id, 'lan 2');
        void second.catch(() => undefined);
        await waitForLock(scratch.pool, 10_000, 2);
        await blocker.query('COMMIT');
        results = await Promise.allSettled([first, second]);
      } finally {
        blocker.release();
      }

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((lost.reason as { status?: number }).status).toBe(404);

      const { rows } = await scratch.pool.query<{ same: boolean }>(
        `SELECT bool_and(a.voided_at = s.voided_at) AS same
           FROM ip_address a JOIN subnet s ON s.id = a.subnet_id WHERE s.id = $1`,
        [id],
      );
      expect(rows[0].same).toBe(true);

      await subnets.restore(ACTOR, id);
      expect(await aliveAddresses(id)).toBe(5);
    },
    TEST_TIMEOUT,
  );

  it(
    'đường thường: một lượt ngừng dùng rồi bật lại vẫn đúng',
    async () => {
      const id = await subnetWithAddresses(3);
      await subnets.voidSubnet(ACTOR, id, 'mot lan');
      expect(await aliveAddresses(id)).toBe(0);
      await subnets.restore(ACTOR, id);
      expect(await aliveAddresses(id)).toBe(3);
    },
    TEST_TIMEOUT,
  );
});
