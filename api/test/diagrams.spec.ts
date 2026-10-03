import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migration-runner';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { DevicesApiService } from '../src/modules/devices/devices.api';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DiagramsService } from '../src/modules/diagrams/diagrams.service';
import type { IpamApiService } from '../src/modules/ipam/ipam.api';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Cây bản vẽ + phiên bản (AD-18, Q-23) trên Postgres thật: lời hứa ở đây là phiên bản chỉ-thêm,
 * "bản lưu sau thắng" khi hai người lưu cùng lúc (khoá hàng `diagram`, không đâm khoá duy nhất
 * `seq`), và phiên bản + lịch sử + nhật ký sống chết cùng một transaction (AD-5).
 */

const TEST_TIMEOUT = 180_000;
const SA = { email: 'e2e-diagram-sa@qa.test', role: 'sa' as const, fullName: 'E2E Người A' };
const MEMBER = { email: 'e2e-diagram-member@qa.test', role: 'member' as const, fullName: 'E2E Người B' };

const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function deviceCell(id: string, deviceId: string, code: string): string {
  return `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="${id}"><mxCell style="shape=mxgraph.cisco.switches.workgroup_switch;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="40" as="geometry"/></mxCell></UserObject>`;
}

function shape(id: string, value: string): string {
  return `<mxCell id="${id}" value="${value}" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>`;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="s1"><rect width="10" height="10"/><text>Tầng 3</text></g><script>alert(1)</script></svg>';

describe('Sơ đồ mạng · cây bản vẽ, phiên bản, lịch sử (AD-18)', () => {
  let scratch: ScratchDb;
  let service: DiagramsService;
  let deviceId: string;
  let siteId: string;
  let typeId: string;
  let catalogService: CatalogService;

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: number }>(sql, params);
    return rows[0].n;
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_diagrams');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const audit = new AuditWriterService(db);
    catalogService = new CatalogService(db, audit);
    const catalog = new CatalogApiService(catalogService);
    const devices = new DevicesApiService(new DevicesService(db, catalog, audit, noRetirement, new DeviceSearchRegistry()));
    const ipam = {
      heldAddressesOf: (ids: string[]) => Promise.resolve(new Map(ids.map((id) => [id, ['10.20.0.5']]))),
    } as unknown as IpamApiService;
    service = new DiagramsService(db, audit, new SystemConfigService(db), catalog, devices, ipam, new UsersApiService(new UsersService(db)));

    for (const user of [SA, MEMBER]) {
      await scratch.pool.query(
        `INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, 'x')`,
        [user.email, user.fullName, user.role],
      );
    }
    siteId = (await scratch.pool.query<{ id: string }>(`INSERT INTO site (code, name) VALUES ('E2E-SD', 'Site sơ đồ') RETURNING id`)).rows[0].id;
    const type = await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('Switch E2E SD') RETURNING id`);
    typeId = type.rows[0].id;
    deviceId = (
      await scratch.pool.query<{ id: string }>(
        `INSERT INTO device (code, name, device_type_id, site_id, model, serial) VALUES ('SW-E2E-SD', 'Switch lõi', $1, $2, 'C9300', 'FOC123') RETURNING id`,
        [typeId, siteId],
      )
    ).rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('migration: bảng bản thử đã bỏ, bảng thật có mặt', async () => {
    const { rows } = await scratch.pool.query<{ t: string | null }>(
      `SELECT to_regclass('public.diagram_spike')::text AS t UNION ALL SELECT to_regclass('public.diagram_version')::text`,
    );
    expect(rows.map((r) => r.t)).toEqual([null, 'diagram_version']);
  });

  describe('cây', () => {
    it('tạo gốc + con kèm site, cây trả tên/loại/trạng thái; mỗi lượt một dòng lịch sử + nhật ký', async () => {
      const root = await service.create(SA.email, { name: 'E2E Tổng công ty', nodeType: 'company' });
      const child = await service.create(MEMBER.email, { name: 'E2E Site chính', nodeType: 'site', parentId: root.id, siteId });
      const tree = await service.tree();
      expect(tree.find((n) => n.id === child.id)).toMatchObject({ parentId: root.id, nodeType: 'site', siteId, status: 'empty', latestVersion: null });
      expect(await count(`SELECT count(*)::int AS n FROM diagram_history WHERE diagram_id = $1 AND action = 'created'`, [child.id])).toBe(1);
      expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'diagram.created' AND object_id = $1`, [child.id])).toBe(1);
    });

    it('tên trùng giữa hai nút anh em → 409; khác cha thì được', async () => {
      const root = await service.create(SA.email, { name: 'E2E Gốc trùng', nodeType: 'company' });
      await service.create(SA.email, { name: 'E2E Tầng 1', nodeType: 'floor', parentId: root.id });
      await expect(service.create(SA.email, { name: 'e2e tầng 1 ', nodeType: 'floor', parentId: root.id })).rejects.toMatchObject({ status: 409 });
      const other = await service.create(SA.email, { name: 'E2E Gốc khác', nodeType: 'company' });
      await expect(service.create(SA.email, { name: 'E2E Tầng 1', nodeType: 'floor', parentId: other.id })).resolves.toBeDefined();
    });

    it('site trỏ sai → 400, không ghi gì', async () => {
      const before = await count(`SELECT count(*)::int AS n FROM diagram`);
      await expect(
        service.create(SA.email, { name: 'E2E Site ma', nodeType: 'site', siteId: '7b0c1c1e-0000-4000-8000-0000000000ff' }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await count(`SELECT count(*)::int AS n FROM diagram`)).toBe(before);
    });

    it('đổi tên + chuyển nhánh ghi lịch sử; chuyển vào chính nhánh con của nó → 400', async () => {
      const a = await service.create(SA.email, { name: 'E2E A', nodeType: 'company' });
      const b = await service.create(SA.email, { name: 'E2E B', nodeType: 'floor', parentId: a.id });
      await expect(service.update(SA.email, a.id, { parentId: b.id })).rejects.toMatchObject({ status: 400 });
      const renamed = await service.update(SA.email, b.id, { name: 'E2E B mới', parentId: null });
      expect(renamed).toMatchObject({ name: 'E2E B mới', parentId: null });
      const { rows } = await scratch.pool.query<{ changes: Record<string, { before: unknown; after: unknown }> }>(
        `SELECT changes FROM diagram_history WHERE diagram_id = $1 AND action = 'updated'`,
        [b.id],
      );
      expect(rows[0].changes.name).toEqual({ before: 'E2E B', after: 'E2E B mới' });
      expect(rows[0].changes.parentId).toEqual({ before: a.id, after: null });
    });

    it('lưu trữ: còn nút con sống → 409; nút lá thì rời cây, không xoá hàng', async () => {
      const a = await service.create(SA.email, { name: 'E2E Lưu trữ', nodeType: 'company' });
      const b = await service.create(SA.email, { name: 'E2E Lá', nodeType: 'room', parentId: a.id });
      await expect(service.archive(SA.email, a.id)).rejects.toMatchObject({ status: 409 });
      await service.archive(SA.email, b.id);
      expect((await service.tree()).some((n) => n.id === b.id)).toBe(false);
      expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE id = $1 AND archived_at IS NOT NULL`, [b.id])).toBe(1);
      await expect(service.save(SA.email, b.id, { xml: page(''), svg: SVG, basedOnVersionId: null })).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('phiên bản', () => {
    let diagramId: string;

    beforeAll(async () => {
      diagramId = (await service.create(SA.email, { name: 'E2E Bản vẽ phiên bản', nodeType: 'floor' })).id;
    });

    it('lưu đầu tiên: một phiên bản + lịch sử + nhật ký; SVG lưu bản đã làm sạch; chụp thiết bị', async () => {
      const v1 = await service.save(SA.email, diagramId, {
        xml: page(deviceCell('d1', deviceId, 'SW-E2E-SD') + shape('s1', 'Tầng 3')),
        svg: SVG,
        basedOnVersionId: null,
      });
      expect(v1).toMatchObject({ seq: 1, summary: 'Thêm 1 thiết bị, 1 hình tự do', savedBy: SA.email, savedByName: SA.fullName });
      const { rows } = await scratch.pool.query<{ svg: string; device_snapshot: unknown[] }>(
        `SELECT svg, device_snapshot FROM diagram_version WHERE id = $1`,
        [v1.id],
      );
      expect(rows[0].svg).not.toContain('<script');
      expect(rows[0].svg).toContain('data-cell-id="s1"');
      expect(rows[0].device_snapshot).toEqual([
        {
          id: deviceId,
          code: 'SW-E2E-SD',
          name: 'Switch lõi',
          type: 'Switch E2E SD',
          model: 'C9300',
          serial: 'FOC123',
          ips: ['10.20.0.5'],
          site: 'E2E-SD',
          cabinet: null,
          u: null,
          status: 'in_use',
        },
      ]);
      expect(await count(`SELECT count(*)::int AS n FROM diagram_history WHERE diagram_id = $1 AND action = 'version.saved'`, [diagramId])).toBe(1);
      expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'diagram.saved' AND object_id = $1`, [diagramId])).toBe(1);
      expect((await service.tree()).find((n) => n.id === diagramId)).toMatchObject({ status: 'draft', latestVersion: { id: v1.id, seq: 1 } });
    });

    it('XML độc / nhãn trông như mật khẩu → 400, không ghi phiên bản lẫn nhật ký', async () => {
      const before = await count(`SELECT count(*)::int AS n FROM diagram_version WHERE diagram_id = $1`, [diagramId]);
      const evil = page('<mxCell id="x" value="&lt;img src=x onerror=alert(1)&gt;" style="html=1;" vertex="1" parent="1"/>');
      await expect(service.save(SA.email, diagramId, { xml: evil, svg: SVG, basedOnVersionId: null })).rejects.toMatchObject({
        response: { code: 'DIAGRAM_XML_INVALID' },
      });
      await expect(
        service.save(SA.email, diagramId, { xml: page(shape('s9', 'pass Xk9#mQ2!vLp7')), svg: SVG, basedOnVersionId: null }),
      ).rejects.toMatchObject({ response: { code: 'DIAGRAM_LABEL_SECRET' } });
      await expect(service.save(SA.email, diagramId, { xml: page(''), svg: '<html/>', basedOnVersionId: null })).rejects.toMatchObject({
        response: { code: 'DIAGRAM_SVG_INVALID' },
      });
      expect(await count(`SELECT count(*)::int AS n FROM diagram_version WHERE diagram_id = $1`, [diagramId])).toBe(before);
    });

    it('người thứ hai lưu trên bản cũ: vẫn lưu được (bản sau thắng), tóm tắt ghi "lưu đè lên bản của …"', async () => {
      const [latest] = await service.versions(diagramId);
      const mine = await service.save(SA.email, diagramId, {
        xml: page(deviceCell('d1', deviceId, 'SW-E2E-SD') + shape('s1', 'Tầng 3') + shape('s2', 'ISP')),
        svg: SVG,
        basedOnVersionId: latest.id,
      });
      const theirs = await service.save(MEMBER.email, diagramId, {
        xml: page(shape('s1', 'Tầng 3')),
        svg: SVG,
        basedOnVersionId: latest.id,
      });
      expect(mine.summary).toBe('1 hình tự do');
      expect(theirs.summary).toBe(`Bỏ 1 thiết bị, 1 hình tự do · lưu đè lên bản của ${SA.fullName}`);
      expect(theirs.seq).toBe(mine.seq + 1);
    });

    it('hai lượt lưu cùng lúc: mỗi lượt một số thứ tự, không lượt nào chết vì trùng', async () => {
      const results = await Promise.all(
        [1, 2, 3].map((n) => service.save(SA.email, diagramId, { xml: page(shape(`c${n}`, `Khung ${n}`)), svg: SVG, basedOnVersionId: null })),
      );
      const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
      expect(new Set(seqs).size).toBe(3);
      expect(seqs[2] - seqs[0]).toBe(2);
    });

    it('phiên bản là chỉ-thêm ở tầng DB', async () => {
      await expect(scratch.pool.query(`UPDATE diagram_version SET summary = 'x' WHERE diagram_id = $1`, [diagramId])).rejects.toThrow(/append-only/);
      await expect(scratch.pool.query(`DELETE FROM diagram_version WHERE diagram_id = $1`, [diagramId])).rejects.toThrow(/append-only/);
    });

    it('mở nội dung: mỗi lần một dòng `diagram.viewed` (ai, phiên bản, chế độ); mở được bản cũ', async () => {
      const versions = await service.versions(diagramId);
      const oldest = versions[versions.length - 1];
      const latest = await service.content(MEMBER.email, diagramId, { mode: 'edit' });
      const old = await service.content(MEMBER.email, diagramId, { mode: 'view', versionId: oldest.id });
      expect(latest.version?.id).toBe(versions[0].id);
      expect(old.version).toMatchObject({ id: oldest.id, seq: 1 });
      expect(old.version?.svg).not.toContain('<script');
      const { rows } = await scratch.pool.query<{ actor: string; detail: Record<string, unknown> }>(
        `SELECT actor, detail FROM audit_log WHERE action = 'diagram.viewed' AND object_id = $1 ORDER BY created_at`,
        [diagramId],
      );
      expect(rows.map((r) => [r.actor, r.detail.mode, r.detail.versionId])).toEqual([
        [MEMBER.email, 'edit', versions[0].id],
        [MEMBER.email, 'view', oldest.id],
      ]);
    });

    it('bản vẽ chưa lưu lần nào: nội dung rỗng, không lỗi', async () => {
      const fresh = await service.create(SA.email, { name: 'E2E Chưa vẽ', nodeType: 'other' });
      await expect(service.content(SA.email, fresh.id, { mode: 'view' })).resolves.toMatchObject({ version: null });
    });

    it('phiên bản của bản vẽ khác → 404', async () => {
      const other = await service.create(SA.email, { name: 'E2E Bản khác', nodeType: 'other' });
      const [latest] = await service.versions(diagramId);
      await expect(service.content(SA.email, other.id, { mode: 'view', versionId: latest.id })).rejects.toMatchObject({ status: 404 });
    });

    it('đặt tên: tên mới nhất thắng, không UPDATE phiên bản; Thành viên đặt tên bản của người khác → 403', async () => {
      const versions = await service.versions(diagramId);
      const v1 = versions[versions.length - 1];
      await service.label({ email: SA.email, role: 'sa' }, diagramId, v1.id, 'Trước khi thay core');
      await service.label({ email: SA.email, role: 'sa' }, diagramId, v1.id, 'Sau khi thay core 2026');
      await expect(service.label({ email: MEMBER.email, role: 'member' }, diagramId, v1.id, 'Bậy')).rejects.toMatchObject({ status: 403 });
      const after = await service.versions(diagramId);
      expect(after.find((v) => v.id === v1.id)?.label).toBe('Sau khi thay core 2026');
      expect(await count(`SELECT count(*)::int AS n FROM diagram_version_label WHERE version_id = $1`, [v1.id])).toBe(2);
    });

    it('khôi phục: tạo phiên bản MỚI chép XML bản cũ, không xoá gì', async () => {
      const before = await service.versions(diagramId);
      const v1 = before[before.length - 1];
      const restored = await service.restore(SA.email, diagramId, v1.id);
      expect(restored.seq).toBe(before[0].seq + 1);
      expect(restored.summary).toMatch(/^Khôi phục từ phiên bản #1/);
      expect(restored.restoredFromSeq).toBe(1);
      const { rows } = await scratch.pool.query<{ same: boolean }>(
        `SELECT (SELECT xml FROM diagram_version WHERE id = $1) = (SELECT xml FROM diagram_version WHERE id = $2) AS same`,
        [restored.id, v1.id],
      );
      expect(rows[0].same).toBe(true);
      expect(await service.versions(diagramId)).toHaveLength(before.length + 1);
      expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'diagram.version_restored' AND object_id = $1`, [diagramId])).toBe(1);
    });

    it('chi tiết tóm tắt nhóm theo loại', async () => {
      const versions = await service.versions(diagramId);
      const v1 = versions[versions.length - 1];
      const detail = await service.changes(diagramId, v1.id);
      expect(detail.devices.added).toEqual([{ id: deviceId, label: 'SW-E2E-SD' }]);
    });

    it('lịch sử đọc diagram_history, mới trước, kèm họ tên', async () => {
      const rows = await service.history(diagramId);
      expect(rows[0]).toMatchObject({ action: 'version.restored', actorName: SA.fullName });
    });
  });

  describe('Thiết bị kho — XML khô, hydrate từ kho, thông tin máy (AD-18)', () => {
    const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>';
    const GONE = '7b0c1c1e-0000-4000-8000-0000000000ee';
    let diagramId: string;

    beforeAll(async () => {
      const vendorId = (await scratch.pool.query<{ id: string }>(`INSERT INTO vendor (name, phone) VALUES ('NCC E2E SD', '1900 1234') RETURNING id`)).rows[0].id;
      await scratch.pool.query(`UPDATE device SET vendor_id = $1, warranty_end = '2027-01-31' WHERE id = $2`, [vendorId, deviceId]);
      await scratch.pool.query(`UPDATE device_type SET diagram_shape = 'mxgraph.networks.switch' WHERE id = $1`, [typeId]);
      diagramId = (await service.create(SA.email, { name: 'E2E Thiết bị kho', nodeType: 'room' })).id;
    });

    it('lưu XML ướt → kho giữ XML khô (không hình, nhãn là mã); mở sửa → hydrate hình + nhãn từ kho', async () => {
      const wet = page(
        `<UserObject label="SW-E2E-SD&#xa;10.20.0.5" ims_device_id="${deviceId}" ims_device_code="SW-E2E-SD" ims_device_ip="10.20.0.5" id="d1">` +
          '<mxCell style="shape=mxgraph.networks.switch;outlineConnect=0;html=0;fontSize=14;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="30" as="geometry"/></mxCell></UserObject>',
      );
      await service.save(MEMBER.email, diagramId, { xml: wet, svg: SVG, basedOnVersionId: null });
      const { rows } = await scratch.pool.query<{ xml: string }>(
        `SELECT xml FROM diagram_version WHERE diagram_id = $1 ORDER BY seq DESC LIMIT 1`,
        [diagramId],
      );
      expect(rows[0].xml).toContain('label="SW-E2E-SD"');
      expect(rows[0].xml).toContain('style="fontSize=14;"');
      expect(rows[0].xml).not.toContain('ims_device_ip');

      const opened = await service.content(MEMBER.email, diagramId, { mode: 'edit' });
      expect(opened.version?.xml).toContain('shape=mxgraph.networks.switch;');
      expect(opened.version?.xml).toContain('label="SW-E2E-SD&#xa;10.20.0.5&#xa;E2E-SD"');
      expect(opened.deviceCells).toEqual([{ cellId: 'd1', deviceId }]);
      expect(opened.devices[0]).toMatchObject({
        id: deviceId,
        found: true,
        code: 'SW-E2E-SD',
        name: 'Switch lõi',
        model: 'C9300',
        serial: 'FOC123',
        ips: ['10.20.0.5'],
        siteCode: 'E2E-SD',
        vendorName: 'NCC E2E SD',
        vendorPhone: '1900 1234',
        warrantyEnd: '2027-01-31',
      });
    });

    it('đổi hình của loại ở Danh mục (kể cả tải SVG riêng) → lần mở sau hiện hình mới, không sửa bản vẽ', async () => {
      await catalogService.update(MEMBER.email, 'device_type', typeId, { diagramShape: 'mxgraph.cisco.switches.workgroup_switch' });
      const reopened = await service.content(SA.email, diagramId, { mode: 'edit' });
      expect(reopened.version?.xml).toContain('shape=mxgraph.cisco.switches.workgroup_switch;');

      await catalogService.setDiagramIcon(SA.email, typeId, ICON, 100);
      const withIcon = await service.content(SA.email, diagramId, { mode: 'edit' });
      expect(withIcon.version?.xml).toContain('shape=image;image=data:image/svg+xml,%3Csvg');
      await catalogService.removeDiagramIcon(SA.email, typeId);
      expect((await service.content(SA.email, diagramId, { mode: 'edit' })).version?.xml).not.toContain('data:image/svg+xml');
    });

    it('ims_device_id không còn trong kho → ô "Không tìm thấy trong kho", không lỗi trang', async () => {
      const d = await service.create(SA.email, { name: 'E2E Máy mất', nodeType: 'other' });
      await service.save(SA.email, d.id, { xml: page(deviceCell('g1', GONE, 'SW-E2E-GONE')), svg: SVG, basedOnVersionId: null });
      const opened = await service.content(SA.email, d.id, { mode: 'edit' });
      expect(opened.version?.xml).toContain('label="SW-E2E-GONE&#xa;⚠ Không tìm thấy trong kho"');
      expect(opened.devices).toEqual([expect.objectContaining({ id: GONE, found: false })]);
    });

    it('thông tin máy theo lô: một lượt cho nhiều id, id rác/không còn thành found=false; ô chèn theo hình của loại', async () => {
      const infos = await service.deviceInfos([deviceId, GONE, 'không-phải-uuid', deviceId]);
      expect(infos.map((i) => [i.id, i.found])).toEqual([
        [deviceId, true],
        [GONE, false],
        ['không-phải-uuid', false],
      ]);
      expect(infos[0].cell).toMatchObject({ width: 64, height: 32 });
      expect(infos[0].cell.style).toContain('shape=mxgraph.cisco.switches.workgroup_switch;');
    });

    it('"Có mặt trong các bản vẽ": chỉ bản vẽ có máy ở phiên bản MỚI NHẤT, bỏ bản vẽ đã lưu trữ', async () => {
      const gone = await service.create(SA.email, { name: 'E2E Đã bỏ máy', nodeType: 'other' });
      await service.save(SA.email, gone.id, { xml: page(deviceCell('d1', deviceId, 'SW-E2E-SD')), svg: SVG, basedOnVersionId: null });
      await service.save(SA.email, gone.id, { xml: page(shape('s1', 'x')), svg: SVG, basedOnVersionId: null });
      const archivedOne = await service.create(SA.email, { name: 'E2E Lưu trữ có máy', nodeType: 'other' });
      await service.save(SA.email, archivedOne.id, { xml: page(deviceCell('d1', deviceId, 'SW-E2E-SD')), svg: SVG, basedOnVersionId: null });
      await service.archive(SA.email, archivedOne.id);
      const names = (await service.diagramsWithDevice(deviceId)).map((d) => d.name);
      expect(names).toContain('E2E Thiết bị kho');
      expect(names).not.toContain('E2E Đã bỏ máy');
      expect(names).not.toContain('E2E Lưu trữ có máy');
    });

    it('biểu tượng SVG có script → từ chối, không ghi gì; SVG sạch → cất bản đã lọc + lịch sử danh mục', async () => {
      await expect(
        catalogService.setDiagramIcon(SA.email, typeId, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>', 100),
      ).rejects.toMatchObject({ response: { code: 'DIAGRAM_ICON_INVALID' } });
      expect(await count(`SELECT count(*)::int AS n FROM device_type_icon WHERE device_type_id = $1`, [typeId])).toBe(0);
      await catalogService.setDiagramIcon(SA.email, typeId, ICON.replace('</svg>', '<foreignObject><div>x</div></foreignObject></svg>'), 100);
      expect(await catalogService.diagramIcon(typeId)).toBe(ICON);
      expect(await count(`SELECT count(*)::int AS n FROM catalog_history WHERE entity_id = $1 AND action = 'diagram_icon_set'`, [typeId])).toBe(2);
      const listed = await catalogService.list('device_type', { page: 1, limit: 50 }, 'Switch E2E SD');
      expect(listed.items[0]).toMatchObject({ diagramShape: 'mxgraph.cisco.switches.workgroup_switch', hasDiagramIcon: true });
      await catalogService.removeDiagramIcon(SA.email, typeId);
    });

    it('hình ngoài danh sách đóng → 400 ở tầng service; CHECK của DB chặn chuỗi style', async () => {
      await expect(catalogService.update(SA.email, 'device_type', typeId, { diagramShape: 'shape=image;image=https://x' })).rejects.toMatchObject({
        response: { code: 'DIAGRAM_SHAPE_INVALID' },
      });
      await expect(scratch.pool.query(`UPDATE device_type SET diagram_shape = 'x;image=https://x' WHERE id = $1`, [typeId])).rejects.toThrow(
        /device_type_diagram_shape_check/,
      );
    });

    it('migration gán sẵn hình cho loại có từ đầu', async () => {
      const { rows } = await scratch.pool.query<{ name: string; diagram_shape: string | null }>(
        `SELECT name::text, diagram_shape FROM device_type WHERE name IN ('Switch', 'Thiết bị khác') ORDER BY name`,
      );
      expect(rows).toEqual([
        { name: 'Switch', diagram_shape: 'mxgraph.networks.switch' },
        { name: 'Thiết bị khác', diagram_shape: null },
      ]);
    });
  });

  it('bản vẽ 300 hình + 600 dây: lưu được, API trả nội dung dưới 1 giây (NFR-05, NFR-07)', async () => {
    const d = await service.create(SA.email, { name: 'E2E Bản vẽ lớn', nodeType: 'other' });
    const shapes = Array.from({ length: 300 }, (_, i) => shape(`v${i}`, `Máy ${i}`)).join('');
    const edges = Array.from(
      { length: 600 },
      (_, i) =>
        `<mxCell id="e${i}" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="v${i % 300}" target="v${(i * 7 + 1) % 300}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    ).join('');
    const saved = await service.save(SA.email, d.id, { xml: page(shapes + edges), svg: SVG, basedOnVersionId: null });
    expect(saved.summary).toBe('Thêm 600 dây, 300 hình tự do');
    const started = performance.now();
    const content = await service.content(SA.email, d.id, { mode: 'edit' });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(content.version?.seq).toBe(1);
  });

  describe('đang có người mở sửa', () => {
    it('B thấy A trong thời gian giữ; A im lặng quá thì thôi; nhật ký chỉ ghi lúc vào, không mỗi nhịp', async () => {
      const d = await service.create(SA.email, { name: 'E2E Có mặt', nodeType: 'other' });
      await service.heartbeat({ email: SA.email, fullName: SA.fullName }, d.id);
      await service.heartbeat({ email: SA.email, fullName: SA.fullName }, d.id);
      const seen = await service.heartbeat({ email: MEMBER.email, fullName: MEMBER.fullName }, d.id);
      expect(seen.others).toEqual([{ email: SA.email, fullName: SA.fullName }]);
      expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'diagram.editing_started' AND object_id = $1`, [d.id])).toBe(2);

      await scratch.pool.query(`UPDATE diagram_presence SET seen_at = now() - interval '1 hour' WHERE user_email = $1`, [SA.email]);
      const later = await service.heartbeat({ email: MEMBER.email, fullName: MEMBER.fullName }, d.id);
      expect(later.others).toEqual([]);
    });
  });

  describe('lượt dọn E2E (`api/scripts/reset-e2e.mjs` vùng `diagrams`)', () => {
    /*
     * Đọc ĐÚNG các câu SQL của vùng `diagrams` trong script dọn rồi chạy chúng trên DB này: script
     * không có bài kiểm nào khác, và một bảng mới quên dọn (hay sai thứ tự con-trước-cha) chỉ lộ ra
     * ở cửa canh rác cuối lượt E2E, nửa tiếng sau.
     */
    function diagramResetSql(): string[] {
      const source = readFileSync(join(__dirname, '..', 'scripts', 'reset-e2e.mjs'), 'utf8');
      const block = /\n {2}diagrams: \[([\s\S]*?)\n {2}\],/.exec(source);
      if (!block) throw new Error('Không tìm thấy vùng diagrams trong reset-e2e.mjs');
      return [...block[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    }

    it('dọn cả cây con của bản vẽ E2E (kể cả nút con không mang chữ E2E), không đụng bản vẽ thật', async () => {
      const root = await service.create(SA.email, { name: 'E2E Gốc dọn', nodeType: 'company' });
      const child = await service.create(SA.email, { name: 'Tầng con', nodeType: 'floor', parentId: root.id });
      const v = await service.save(SA.email, child.id, { xml: page(shape('s1', 'x')), svg: SVG, basedOnVersionId: null });
      await service.label({ email: SA.email, role: 'sa' }, child.id, v.id, 'Bản có tên');
      await service.heartbeat({ email: SA.email, fullName: SA.fullName }, child.id);
      await scratch.pool.query(`UPDATE diagram SET official_version_id = $1 WHERE id = $2`, [v.id, child.id]);
      const real = await service.create(SA.email, { name: 'Bản vẽ thật', nodeType: 'company' });

      const client = await scratch.pool.connect();
      try {
        await client.query('BEGIN');
        for (const statement of diagramResetSql()) await client.query(statement);
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE id = ANY($1)`, [[root.id, child.id]])).toBe(0);
      expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE name ILIKE '%E2E%'`)).toBe(0);
      expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE id = $1`, [real.id])).toBe(1);
      for (const table of ['diagram_version', 'diagram_version_label', 'diagram_history', 'diagram_presence']) {
        expect([table, await count(`SELECT count(*)::int AS n FROM ${table} WHERE diagram_id NOT IN (SELECT id FROM diagram)`)]).toEqual([table, 0]);
      }
      // Trigger chỉ-thêm bật lại sau lượt dọn.
      await expect(scratch.pool.query(`DELETE FROM diagram_history`)).rejects.toThrow(/append-only/);
    });
  });
});
