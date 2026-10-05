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
import { createScratchDb, migrationsDir, type ScratchDb } from './db';
import { noPhotos } from './device-photos-stub';

/**
 * Góp ý 05/10 của Q-23 trên Postgres thật: xem lại / bỏ lưu trữ bản vẽ (quyền như lưu trữ, bản
 * cha còn cất thì chặn, bia mộ "Xoá hẳn" không bao giờ lộ ra), và nhân bản bản vẽ con từ MỘT
 * phiên bản chọn của bản cha (phiên bản phải thuộc đúng bản cha).
 */

const TEST_TIMEOUT = 180_000;
const SA = { email: 'e2e-arch-sa@qa.test', role: 'sa' as const, fullName: 'E2E SA lưu trữ' };
const MEMBER = { email: 'e2e-arch-member@qa.test', role: 'member' as const, fullName: 'E2E Thành viên lưu trữ' };

const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function shape(id: string, value: string): string {
  return `<mxCell id="${id}" value="${value}" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>`;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="s1"><rect width="10" height="10"/></g></svg>';

describe('Sơ đồ mạng · bản đã lưu trữ + nhân bản theo phiên bản (Q-23, 05/10)', () => {
  let scratch: ScratchDb;
  let service: DiagramsService;

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: number }>(sql, params);
    return rows[0].n;
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_diagram_archive');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const audit = new AuditWriterService(db);
    const catalog = new CatalogApiService(new CatalogService(db, audit));
    const devicesService = new DevicesService(db, catalog, audit, noRetirement, new DeviceSearchRegistry());
    const devices = new DevicesApiService(devicesService, new DevicePortsService(db, devicesService), noPhotos);
    const ipam = { heldAddressesOf: (ids: string[]) => Promise.resolve(new Map(ids.map((id) => [id, []]))) } as unknown as IpamApiService;
    service = new DiagramsService(db, audit, new SystemConfigService(db), catalog, devices, ipam, new UsersApiService(new UsersService(db)));
    for (const user of [SA, MEMBER]) {
      await scratch.pool.query(`INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, 'x')`, [user.email, user.fullName, user.role]);
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  describe('đã lưu trữ', () => {
    it('danh sách lưu trữ có bản đã cất (kèm người cất), không có bản sống, không có bia mộ Xoá hẳn', async () => {
      const live = await service.create(SA.email, { name: 'E2E Sống', nodeType: 'company' });
      const shelved = await service.create(SA.email, { name: 'E2E Đã cất', nodeType: 'company' });
      const gone = await service.create(SA.email, { name: 'E2E Bia mộ', nodeType: 'company' });
      await service.archive(SA, shelved.id);
      await scratch.pool.query(
        `UPDATE diagram SET archived_at = now(), archived_by = $2, deleted_at = now(), deleted_by = $2 WHERE id = $1`,
        [gone.id, SA.email],
      );
      const list = await service.archivedList();
      expect(list.map((n) => n.id)).toContain(shelved.id);
      expect(list.map((n) => n.id)).not.toContain(live.id);
      expect(list.map((n) => n.id)).not.toContain(gone.id);
      expect(list.find((n) => n.id === shelved.id)).toMatchObject({ archivedBy: SA.email, archivedByName: SA.fullName });
      expect(list.find((n) => n.id === shelved.id)?.archivedAt).toEqual(expect.any(String));
    });

    it('bỏ lưu trữ: bản về lại cây, ghi lịch sử "unarchived" + nhật ký diagram.unarchived trong cùng lượt', async () => {
      const node = await service.create(SA.email, { name: 'E2E Cất rồi lấy lại', nodeType: 'company' });
      await service.archive(SA, node.id);
      const back = await service.unarchive(SA, node.id);
      expect(back).toMatchObject({ id: node.id, archivedAt: null });
      expect((await service.tree()).some((n) => n.id === node.id)).toBe(true);
      expect(await count(`SELECT count(*)::int AS n FROM diagram_history WHERE diagram_id = $1 AND action = 'unarchived'`, [node.id])).toBe(1);
      expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'diagram.unarchived' AND object_id = $1 AND actor = $2`, [node.id, SA.email])).toBe(1);
      expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE id = $1 AND archived_by IS NULL`, [node.id])).toBe(1);
    });

    it('bản vẽ con mà bản cha còn đang lưu trữ → 409, không ghi gì', async () => {
      const parent = await service.create(SA.email, { name: 'E2E Cha cất', nodeType: 'company' });
      const child = await service.create(SA.email, { name: 'E2E Con cất', nodeType: 'floor', parentId: parent.id });
      await service.archive(SA, child.id);
      await service.archive(SA, parent.id);
      await expect(service.unarchive(SA, child.id)).rejects.toMatchObject({ status: 409, response: { code: 'DIAGRAM_PARENT_ARCHIVED' } });
      expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE id = $1 AND archived_at IS NOT NULL`, [child.id])).toBe(1);
      expect(await count(`SELECT count(*)::int AS n FROM diagram_history WHERE diagram_id = $1 AND action = 'unarchived'`, [child.id])).toBe(0);
      await service.unarchive(SA, parent.id);
      await expect(service.unarchive(SA, child.id)).resolves.toMatchObject({ archivedAt: null });
    });

    it('cùng nhánh đã có bản đang dùng trùng tên → 409 tên trùng', async () => {
      const old = await service.create(SA.email, { name: 'E2E Trùng tên cất', nodeType: 'company' });
      await service.archive(SA, old.id);
      await service.create(SA.email, { name: 'E2E Trùng tên cất', nodeType: 'company' });
      await expect(service.unarchive(SA, old.id)).rejects.toMatchObject({ status: 409, response: { code: 'DIAGRAM_NAME_TAKEN' } });
    });

    it('Thành viên: bỏ lưu trữ bản chính thức → 403; bản trình bày của chính mình → được', async () => {
      const official = await service.create(SA.email, { name: 'E2E Chính thức cất', nodeType: 'company' });
      await service.archive(SA, official.id);
      await expect(service.unarchive(MEMBER, official.id)).rejects.toMatchObject({ status: 403 });
      const mine = (
        await scratch.pool.query<{ id: string }>(
          `INSERT INTO diagram (name, node_type, kind, created_by, owner_email, archived_at, archived_by)
           VALUES ('E2E Trình bày của tôi', 'other', 'presentation', $1, $1, now(), $1) RETURNING id`,
          [MEMBER.email],
        )
      ).rows[0].id;
      await expect(service.unarchive(MEMBER, mine)).resolves.toMatchObject({ id: mine, archivedAt: null });
    });

    it('bia mộ "Xoá hẳn" → 404, bản đang sống → không làm gì', async () => {
      const gone = await service.create(SA.email, { name: 'E2E Bia mộ 2', nodeType: 'company' });
      await scratch.pool.query(
        `UPDATE diagram SET archived_at = now(), archived_by = $2, deleted_at = now(), deleted_by = $2 WHERE id = $1`,
        [gone.id, SA.email],
      );
      await expect(service.unarchive(SA, gone.id)).rejects.toMatchObject({ status: 404 });
      const live = await service.create(SA.email, { name: 'E2E Đang sống', nodeType: 'company' });
      await expect(service.unarchive(SA, live.id)).resolves.toMatchObject({ archivedAt: null });
      expect(await count(`SELECT count(*)::int AS n FROM diagram_history WHERE diagram_id = $1 AND action = 'unarchived'`, [live.id])).toBe(0);
    });
  });
});
