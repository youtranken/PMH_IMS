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
import { IpAddressService } from '../src/modules/ipam/ip-address.service';
import { IpamApiService } from '../src/modules/ipam/ipam.api';
import { SubnetService } from '../src/modules/ipam/subnet.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';
import { noPhotos } from './device-photos-stub';

/**
 * Khung bản vẽ con, khung VLAN, khung tủ (AD-18) trên Postgres thật: lưu từ chối gắn MỚI sai
 * (khác nhánh, đã lưu trữ, bản trình bày, dải/tủ không có hoặc đã ngừng dùng) nhưng không chặn
 * khung cũ trỏ vào bản vẽ con bị lưu trữ sau đó; nội dung xem trả khung kèm trạng thái bản vẽ
 * con; khung tủ dựng từ máy trong tủ (bỏ máy thanh lý); thẻ VLAN đếm IP đã cấp / còn trống.
 */

const TEST_TIMEOUT = 180_000;
const SA = { email: 'e2e-frames-sa@qa.test', role: 'sa' as const, fullName: 'E2E Khung' };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="f1"><rect width="10" height="10"/></g></svg>';
const GHOST = '7b0c1c1e-0000-4000-8000-0000000000ff';

const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function frame(id: string, label: string, attrs: Record<string, string>): string {
  const extra = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  return `<UserObject label="${label}"${extra} id="${id}"><mxCell style="rounded=0;container=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="300" height="200" as="geometry"/></mxCell></UserObject>`;
}

describe('Sơ đồ mạng · khung bản vẽ con / VLAN / tủ (AD-18)', () => {
  let scratch: ScratchDb;
  let service: DiagramsService;
  let siteId: string;
  let cabinetId: string;
  let subnetId: string;

  const save = (diagramId: string, body: string, basedOnVersionId: string | null = null) =>
    service.save(SA.email, diagramId, { xml: page(body), svg: SVG, basedOnVersionId });

  beforeAll(async () => {
    scratch = await createScratchDb('ims_diagram_frames');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const audit = new AuditWriterService(db);
    const catalog = new CatalogApiService(new CatalogService(db, audit));
    const devicesService = new DevicesService(db, catalog, audit, noRetirement, new DeviceSearchRegistry());
    const devices = new DevicesApiService(devicesService, new DevicePortsService(db, devicesService), noPhotos);
    const config = new SystemConfigService(db);
    const subnets = new SubnetService(db, audit, catalog, config);
    const ipam = new IpamApiService(new IpAddressService(db, audit, devices, subnets, config), subnets);
    service = new DiagramsService(db, audit, config, catalog, devices, ipam, new UsersApiService(new UsersService(db)));

    await scratch.pool.query(`INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, 'x')`, [SA.email, SA.fullName, SA.role]);
    siteId = (await scratch.pool.query<{ id: string }>(`INSERT INTO site (code, name) VALUES ('E2E-KH', 'Site khung') RETURNING id`)).rows[0].id;
    cabinetId = (await scratch.pool.query<{ id: string }>(`INSERT INTO cabinet (site_id, code, u_height) VALUES ($1, 'E2E-R1', 12) RETURNING id`, [siteId])).rows[0].id;
    const typeId = (await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('Switch E2E KH') RETURNING id`)).rows[0].id;
    await scratch.pool.query(
      `INSERT INTO device (code, name, device_type_id, site_id, cabinet_id, status) VALUES
         ('SW-E2E-KH-02', 'Switch 2', $1, $2, $3, 'in_use'),
         ('SW-E2E-KH-01', 'Switch 1', $1, $2, $3, 'spare'),
         ('SW-E2E-KH-OLD', 'Switch cũ', $1, $2, $3, 'retired'),
         ('SW-E2E-KH-NGOAI', 'Switch ngoài tủ', $1, $2, NULL, 'in_use')`,
      [typeId, siteId, cabinetId],
    );
    subnetId = (
      await scratch.pool.query<{ id: string }>(
        `INSERT INTO subnet (name, cidr, site_id, vlan, created_by) VALUES ('E2E VLAN 10', '10.99.0.0/29', $1, 10, 'x') RETURNING id`,
        [siteId],
      )
    ).rows[0].id;
    await scratch.pool.query(
      `INSERT INTO ip_address (subnet_id, address, used_by, assigned_by, status) VALUES
         ($1, '10.99.0.1', 'Gateway', 'x', 'assigned'),
         ($1, '10.99.0.3', 'Máy in', 'x', 'assigned'),
         ($1, '10.99.0.4', NULL, 'x', 'free')`,
      [subnetId],
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  describe('gắn bản vẽ con', () => {
    it('bản vẽ con nằm dưới bản vẽ này → lưu được; khác nhánh / lưu trữ / bản trình bày → 400 kèm lý do, không ghi phiên bản', async () => {
      const root = await service.create(SA.email, { name: 'E2E Tổng KH', nodeType: 'company' });
      const tower = await service.create(SA.email, { name: 'E2E Tower', nodeType: 'site', parentId: root.id });
      const floor = await service.create(SA.email, { name: 'E2E Tầng 3', nodeType: 'floor', parentId: tower.id });
      const other = await service.create(SA.email, { name: 'E2E Nhánh khác', nodeType: 'company' });
      const shelved = await service.create(SA.email, { name: 'E2E Đã cất', nodeType: 'floor', parentId: tower.id });
      await service.archive(SA, shelved.id);
      // Bản trình bày luôn đứng ở gốc (ràng buộc diagram_presentation_root_check).
      const deck = await service.create(SA.email, { name: 'E2E Trình bày', nodeType: 'other' });
      await scratch.pool.query(`UPDATE diagram SET kind = 'presentation' WHERE id = $1`, [deck.id]);

      // Cháu (không chỉ con trực tiếp) cũng là "dưới bản vẽ này".
      await expect(save(root.id, frame('f1', 'Tầng 3', { ims_child_diagram_id: floor.id }))).resolves.toMatchObject({ seq: 1 });

      for (const [target, pattern] of [
        [other.id, /không nằm dưới bản vẽ này/],
        [shelved.id, /đã lưu trữ/],
        [deck.id, /bản trình bày/],
        [GHOST, /không tồn tại/],
        [root.id, /không nằm dưới bản vẽ này/],
      ] as const) {
        await expect(save(root.id, frame('f2', 'Sai', { ims_child_diagram_id: target }))).rejects.toMatchObject({
          status: 400,
          response: { code: 'DIAGRAM_FRAME_INVALID', message: expect.stringMatching(pattern) },
        });
      }
      const { rows } = await scratch.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM diagram_version WHERE diagram_id = $1`, [root.id]);
      expect(rows[0].n).toBe(1);
    });

    it('bản vẽ con bị lưu trữ SAU khi gắn: bản cha vẫn lưu được, nội dung trả khung kèm dấu "đã lưu trữ"', async () => {
      const root = await service.create(SA.email, { name: 'E2E Gốc KH 2', nodeType: 'company' });
      const child = await service.create(SA.email, { name: 'E2E Phòng server', nodeType: 'room', parentId: root.id });
      const v1 = await save(root.id, frame('f1', 'Phòng server', { ims_child_diagram_id: child.id }));
      await service.archive(SA, child.id);
      await expect(save(root.id, frame('f1', 'Phòng server (cũ)', { ims_child_diagram_id: child.id }), v1.id)).resolves.toMatchObject({ seq: 2 });

      const content = await service.content(SA.email, root.id, { mode: 'view' });
      expect(content.frames).toEqual([
        {
          cellId: 'f1',
          label: 'Phòng server (cũ)',
          childDiagramId: child.id,
          child: { id: child.id, name: 'E2E Phòng server', archived: true, kind: 'official' },
          subnetId: null,
          cabinetId: null,
        },
      ]);
    });

    it('khung trỏ id bản vẽ không còn: nội dung trả `child: null`, không lỗi trang', async () => {
      const root = await service.create(SA.email, { name: 'E2E Gốc KH 3', nodeType: 'company' });
      const child = await service.create(SA.email, { name: 'E2E Con KH 3', nodeType: 'room', parentId: root.id });
      await save(root.id, frame('f1', 'Con', { ims_child_diagram_id: child.id }));
      // Bản vẽ XML là dữ liệu không tin cậy: id rác có thể đã nằm sẵn trong phiên bản (khôi phục, dữ liệu cũ).
      await scratch.pool.query(
        `INSERT INTO diagram_version (diagram_id, seq, xml, svg, cell_index, device_snapshot, summary, summary_detail, saved_by)
         SELECT diagram_id, seq + 1, xml, svg, jsonb_set(cell_index, '{cells,0,ims,ims_child_diagram_id}', to_jsonb($2::text)),
                device_snapshot, summary, summary_detail, saved_by
           FROM diagram_version WHERE diagram_id = $1`,
        [root.id, GHOST],
      );
      const content = await service.content(SA.email, root.id, { mode: 'view' });
      expect(content.frames[0]).toMatchObject({ childDiagramId: GHOST, child: null });
    });
  });

  describe('khung VLAN và khung tủ: gắn mới phải trỏ vào thứ còn dùng', () => {
    it('dải có thật → lưu được; dải không có / đã ngừng dùng → 400', async () => {
      const node = await service.create(SA.email, { name: 'E2E VLAN KH', nodeType: 'floor' });
      await expect(save(node.id, frame('v1', 'VLAN 10', { ims_subnet_id: subnetId }))).resolves.toBeDefined();
      await expect(save(node.id, frame('v2', 'VLAN ma', { ims_subnet_id: GHOST }))).rejects.toMatchObject({
        status: 400,
        response: { code: 'DIAGRAM_FRAME_INVALID' },
      });
      const voided = (
        await scratch.pool.query<{ id: string }>(
          `INSERT INTO subnet (name, cidr, created_by, voided_at, voided_by, void_reason) VALUES ('E2E VLAN cũ', '10.98.0.0/29', 'x', now(), 'x', 'thử') RETURNING id`,
        )
      ).rows[0].id;
      await expect(save(node.id, frame('v3', 'VLAN cũ', { ims_subnet_id: voided }))).rejects.toMatchObject({
        status: 400,
        response: { message: expect.stringMatching(/ngừng dùng/) },
      });
    });

    it('tủ không có → 400', async () => {
      const node = await service.create(SA.email, { name: 'E2E Tủ KH', nodeType: 'room' });
      await expect(save(node.id, frame('r1', 'Tủ ma', { ims_cabinet_id: GHOST }))).rejects.toMatchObject({
        status: 400,
        response: { code: 'DIAGRAM_FRAME_INVALID' },
      });
      await expect(save(node.id, frame('r1', 'Tủ R1', { ims_cabinet_id: cabinetId }))).resolves.toBeDefined();
    });
  });

  describe('dựng khung tủ', () => {
    it('chứa mọi máy đang gắn tủ (bỏ máy thanh lý, bỏ máy ngoài tủ), cao theo u_height, máy chưa khai U ở cột riêng', async () => {
      const frame = await service.cabinetFrame(cabinetId);
      expect(frame.cabinet).toMatchObject({ id: cabinetId, code: 'E2E-R1', uHeight: 12 });
      expect(frame.layout.uHeight).toBe(12);
      // Mặt trước + mặt sau cạnh nhau, cột "Chưa khai U" sau cùng — mọi khung mang ims_cabinet_id.
      expect(frame.layout.frames.map((f) => [f.key, f.attrs.ims_cabinet_id])).toEqual([
        ['rack', cabinetId],
        ['rack-back', cabinetId],
        ['unplaced', cabinetId],
      ]);
      expect(frame.layout.devices.map((d) => [d.code, d.frame])).toEqual([
        ['SW-E2E-KH-01', 'unplaced'],
        ['SW-E2E-KH-02', 'unplaced'],
      ]);
      // Ô máy dựng cùng luật với hộp "Thiết bị kho": nhãn mã + vị trí từ kho.
      expect(frame.layout.devices[0].label).toContain('SW-E2E-KH-01');
    });

    it('tủ không có → 404', async () => {
      await expect(service.cabinetFrame(GHOST)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('thẻ khung VLAN', () => {
    it('CIDR, VLAN, site, số IP đã cấp / còn trống và vài IP trống đầu tiên (hồ sơ "Trống" tính là trống)', async () => {
      const info = await service.subnetInfo(subnetId);
      expect(info).toMatchObject({
        id: subnetId,
        name: 'E2E VLAN 10',
        cidr: '10.99.0.0/29',
        vlan: 10,
        siteCode: 'E2E-KH',
        voided: false,
        total: 6,
        used: 2,
        free: 4,
        firstFree: ['10.99.0.2', '10.99.0.4', '10.99.0.5', '10.99.0.6'],
      });
    });

    it('dải ngừng dùng vẫn đọc được, mang cờ `voided`; dải không có → 404', async () => {
      await scratch.pool.query(`UPDATE subnet SET voided_at = now(), voided_by = 'x', void_reason = 'thử' WHERE id = $1`, [subnetId]);
      await expect(service.subnetInfo(subnetId)).resolves.toMatchObject({ voided: true });
      await expect(service.subnetInfo(GHOST)).rejects.toMatchObject({ status: 404 });
    });
  });
});
