import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { runMigrations } from '../src/database/migration-runner';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { OwnerExistsRegistry } from '../src/common/owner-exists.registry';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { DeviceModelOwnerResolver } from '../src/modules/devices/device-model-owner-resolver';
import { DeviceOwnerResolver } from '../src/modules/devices/device-owner-resolver';
import { DevicePhotosService } from '../src/modules/devices/device-photos.service';
import { DevicePortsService } from '../src/modules/devices/device-ports.service';
import { DevicesApiService } from '../src/modules/devices/devices.api';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DiagramsService } from '../src/modules/diagrams/diagrams.service';
import { FilesApiService } from '../src/modules/files/files.api';
import { FilesService } from '../src/modules/files/files.service';
import { IpAddressService } from '../src/modules/ipam/ip-address.service';
import { IpamApiService } from '../src/modules/ipam/ipam.api';
import { SubnetService } from '../src/modules/ipam/subnet.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Mặt tủ và ảnh thật trên Postgres thật + kho tệp thật: khung tủ xếp máy đúng U ở
 * mặt trước / mặt sau với ảnh từng mặt (ảnh riêng máy đè ảnh model), máy U vượt tủ (dữ liệu cũ) ra
 * cột bên kèm cảnh báo, ảnh chỉ nằm ở XML ướt (kho bản vẽ giữ khô), "Dựng lại mặt tủ" sinh phiên bản
 * mới, bản chụp thiết bị ghi U.
 */
const TEST_TIMEOUT = 180_000;
const SA = { email: 'e2e-rack-sa@qa.test', role: 'sa' as const, fullName: 'E2E Mặt tủ' };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';

const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;

function png(width: number, height: number, fill: string): Buffer {
  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`)
    .render()
    .asPng();
}

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function deviceCell(id: string, deviceId: string, code: string, extra = '', style = 'rounded=1;'): string {
  return `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}"${extra} id="${id}"><mxCell style="${style}" vertex="1" parent="1"><mxGeometry x="10" y="20" width="160" height="15" as="geometry"/></mxCell></UserObject>`;
}

describe('Sơ đồ mạng · mặt tủ theo U + ảnh thật', () => {
  let scratch: ScratchDb;
  let service: DiagramsService;
  let devices: DevicesService;
  let photos: DevicePhotosService;
  let files: FilesService;
  let config: SystemConfigService;
  let dir: string;
  let uploader: string;
  let siteId: string;
  let cabinetId: string;
  let typeId: string;
  let sw: string;
  let srv: string;
  let pc: string;
  const previousDir = process.env.FILE_STORAGE_DIR;

  const upload = (ownerType: 'device' | 'device_model', ownerId: string, buffer: Buffer, name = 'anh.png') =>
    files.save({ buffer, originalName: name, ownerType, ownerId, uploadedBy: uploader, actor: SA.email });

  beforeAll(async () => {
    scratch = await createScratchDb('ims_diagrams_rack');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    dir = await mkdtemp(join(tmpdir(), 'ims-rack-photos-'));
    process.env.FILE_STORAGE_DIR = dir;
    const db = scratch.db;
    const audit = new AuditWriterService(db);
    const catalog = new CatalogApiService(new CatalogService(db, audit));
    config = new SystemConfigService(db);
    const users = new UsersApiService(new UsersService(db));
    devices = new DevicesService(db, catalog, audit, noRetirement, new DeviceSearchRegistry());
    const owners = new OwnerExistsRegistry();
    new DeviceOwnerResolver(owners, devices).onModuleInit();
    new DeviceModelOwnerResolver(owners, db, catalog).onModuleInit();
    files = new FilesService(db, audit, owners, users, config, { register: () => undefined } as unknown as SweepService);
    photos = new DevicePhotosService(db, devices, new FilesApiService(files), config, audit);
    const devicesApi = new DevicesApiService(devices, new DevicePortsService(db, devices), photos);
    const subnets = new SubnetService(db, audit, catalog, config);
    const ipam = new IpamApiService(new IpAddressService(db, audit, devicesApi, subnets, config), subnets);
    service = new DiagramsService(db, audit, config, catalog, devicesApi, ipam, users);

    uploader = (
      await scratch.pool.query<{ id: string }>(`INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, 'x') RETURNING id`, [
        SA.email,
        SA.fullName,
        SA.role,
      ])
    ).rows[0].id;
    siteId = (await scratch.pool.query<{ id: string }>(`INSERT INTO site (code, name) VALUES ('E2E-MT', 'Site mặt tủ') RETURNING id`)).rows[0].id;
    cabinetId = (await scratch.pool.query<{ id: string }>(`INSERT INTO cabinet (site_id, code, u_height) VALUES ($1, 'E2E-MT-R1', 12) RETURNING id`, [siteId]))
      .rows[0].id;
    typeId = (await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('Switch E2E MT') RETURNING id`)).rows[0].id;
    const make = async (code: string, extra: Record<string, unknown>) =>
      (await devices.create(SA.email, { code, name: `Máy ${code}`, deviceTypeId: typeId, siteId, cabinetId, ...extra })).device.id;
    sw = await make('SW-E2E-MT-01', { model: 'C9300-E2E', rackUStart: 1, rackUSize: 1 });
    srv = await make('SRV-E2E-MT-01', { model: 'R740-E2E', rackUStart: 5, rackUSize: 2 });
    pc = await make('PC-E2E-MT-01', {});
  }, TEST_TIMEOUT);

  afterAll(async () => {
    process.env.FILE_STORAGE_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('khung tủ: chỉ mặt trước, máy đúng U (U1 ở đáy), máy chưa khai U ở cột bên', async () => {
    const frame = await service.cabinetFrame(cabinetId);
    expect(frame.layout.frames.map((f) => f.key)).toEqual(['rack', 'unplaced']);
    const at = (code: string) => frame.layout.devices.filter((d) => d.code === code).map((d) => [d.frame, Math.round(d.y), Math.round(d.height)]);
    // Tủ 12U: U1 ở đáy (y lớn nhất), máy 2U cao gấp đôi.
    const swFront = frame.layout.devices.find((d) => d.code === 'SW-E2E-MT-01' && d.frame === 'rack')!;
    const srvFront = frame.layout.devices.find((d) => d.code === 'SRV-E2E-MT-01' && d.frame === 'rack')!;
    expect(swFront.y).toBeGreaterThan(srvFront.y);
    expect(srvFront.height).toBeCloseTo(swFront.height * 2);
    expect(at('SW-E2E-MT-01').map(([f]) => f)).toEqual(['rack']);
    expect(at('PC-E2E-MT-01')).toEqual([['unplaced', expect.any(Number), expect.any(Number)]]);
    // Trên mặt tủ nhãn một dòng bên phải (Q-23 05/10) — vị trí đã là chính khung tủ; máy 2U cao đúng 2U.
    expect(srvFront.label).toBe('SRV-E2E-MT-01');
    expect(srvFront.style).toContain('labelPosition=right');
    expect(srvFront.height).toBeCloseTo(2 * 14.8);
  });

  it('ảnh thật: ảnh riêng máy (mặt trước) đè ảnh model; mặt sau lấy ảnh model; khung tủ dùng ảnh mặt trước; chỉ nhận ảnh đính kèm của chính máy', async () => {
    const own = await upload('device', sw, png(1600, 160, 'red'), 'sw-front.png');
    const other = await upload('device', srv, png(100, 20, 'blue'));
    await expect(photos.setDevicePhotos(SA.email, sw, { front: other.id })).rejects.toMatchObject({ response: { code: 'DEVICE_PHOTO_INVALID' } });
    // WebP: `files` nhận, nhưng bộ vẽ ảnh của server (resvg) không giải mã được — chặn ngay lúc chọn
    // thay vì để ô lặng lẽ hiện biểu tượng và file xuất PNG/PDF mất ảnh.
    const webp = await upload('device', sw, Buffer.concat([Buffer.from('RIFF'), Buffer.from([30, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(22)]), 'anh.webp');
    await expect(photos.setDevicePhotos(SA.email, sw, { front: webp.id })).rejects.toMatchObject({
      response: { code: 'DEVICE_PHOTO_FORMAT', message: expect.stringContaining('JPG hoặc PNG') },
    });
    await photos.setDevicePhotos(SA.email, sw, { front: own.id });
    const model = await photos.ensureModel(SA.email, sw);
    expect(model.label).toBe('C9300-E2E');
    const modelFront = await upload('device_model', model.id, png(200, 20, 'green'));
    const modelBack = await upload('device_model', model.id, png(200, 20, 'yellow'));
    const view = await photos.setModelPhotos(SA.email, sw, { front: modelFront.id, back: modelBack.id });
    expect(view.effective).toEqual({ front: { id: own.id, name: 'sw-front.png' }, back: { id: modelBack.id, name: 'anh.png' } });
    // Lịch sử thiết bị ghi đổi ảnh như mọi trường hồ sơ.
    const [latest] = await devices.history(sw);
    expect(latest).toMatchObject({ action: 'photos-changed', changes: { photoFrontFileId: { before: null, after: own.id } } });

    const frame = await service.cabinetFrame(cabinetId);
    const front = frame.layout.devices.find((d) => d.code === 'SW-E2E-MT-01' && d.frame === 'rack')!;
    expect(frame.layout.devices.filter((d) => d.code === 'SW-E2E-MT-01')).toHaveLength(1);
    expect(front.attrs).toEqual({ ims_photo: 'front' });
    expect(front.style).toMatch(/shape=image;image=data:image\/png,[A-Za-z0-9+/=]+;/);
    // Ảnh 1600px được thu về `diagram.photo_max_px` (480) trước khi nhúng.
    const b64 = /image=data:image\/png,([^;]+);/.exec(front.style)![1];
    expect(Buffer.from(b64, 'base64').readUInt32BE(16)).toBe(480);
    const srvFront = frame.layout.devices.find((d) => d.code === 'SRV-E2E-MT-01' && d.frame === 'rack')!;
    expect(srvFront.attrs).toEqual({});

    const [info] = await service.deviceInfos([sw]);
    expect(info).toMatchObject({ u: 1, uSize: 1, photos: { front: true, back: true } });
  });

  it('ô chọn ảnh: kho giữ XML khô (ims_photo, không ảnh); mở SỬA nhúng ảnh + ims_photo_file_id; mở XEM không đọc ảnh', async () => {
    const node = await service.create(SA.email, { name: 'E2E Ảnh thật', nodeType: 'room' });
    const wetFromEditor = page(deviceCell('c1', sw, 'SW-E2E-MT-01', ' ims_photo="front" ims_photo_file_id="x"', 'shape=image;image=data:image/png,AAAA;'));
    await service.save(SA.email, node.id, { xml: wetFromEditor, svg: SVG, basedOnVersionId: null });
    const { rows } = await scratch.pool.query<{ xml: string }>(`SELECT xml FROM diagram_version WHERE diagram_id = $1`, [node.id]);
    expect(rows[0].xml).toContain('ims_photo="front"');
    expect(rows[0].xml).not.toContain('data:image');
    expect(rows[0].xml).not.toContain('ims_photo_file_id');

    const edit = await service.content(SA.email, node.id, { mode: 'edit' });
    expect(edit.version!.xml).toMatch(/image=data:image\/png,/);
    expect(edit.version!.xml).toContain('ims_photo_file_id=');
    const view = await service.content(SA.email, node.id, { mode: 'view' });
    expect(view.version!.xml).not.toContain('data:image');
  });

  it('XML ướt to vì ảnh vẫn lưu được (trần ướt = trần XML + trần SVG); bản KHÔ quá trần XML thì từ chối', async () => {
    await scratch.pool.query(`UPDATE system_config SET value = '256' WHERE key = 'diagram.xml_max_kb'`);
    config.forget('diagram.xml_max_kb');
    try {
      const node = await service.create(SA.email, { name: 'E2E Ảnh to', nodeType: 'room' });
      const bigPhoto = `shape=image;image=data:image/png,${'A'.repeat(300 * 1024)};`;
      await expect(
        service.save(SA.email, node.id, { xml: page(deviceCell('c1', sw, 'SW-E2E-MT-01', ' ims_photo="front"', bigPhoto)), svg: SVG, basedOnVersionId: null }),
      ).resolves.toMatchObject({ seq: 1 });
      const hugeLabel = `<mxCell id="t1" value="${'x'.repeat(300 * 1024)}" style="text;" vertex="1" parent="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell>`;
      await expect(service.save(SA.email, node.id, { xml: page(hugeLabel), svg: SVG, basedOnVersionId: null })).rejects.toMatchObject({
        response: { code: 'DIAGRAM_XML_INVALID', message: expect.stringContaining('256 KB') },
      });
    } finally {
      await scratch.pool.query(`UPDATE system_config SET value = '2048' WHERE key = 'diagram.xml_max_kb'`);
      config.forget('diagram.xml_max_kb');
    }
  });

  it('"Dựng lại mặt tủ": bản vẽ loại tủ được phiên bản nháp mới từ kho (khô); bản vẽ không phải tủ → 400', async () => {
    const rack = await service.create(SA.email, { name: 'E2E Tủ R1', nodeType: 'cabinet', siteId, cabinetId });
    const version = await service.rebuildRack(SA.email, rack.id);
    expect(version).toMatchObject({ seq: 1, summary: expect.stringContaining('Dựng lại mặt tủ E2E-MT-R1') });
    const { rows } = await scratch.pool.query<{ xml: string; device_snapshot: { id: string; u: number | null; uSize: number | null }[] }>(
      `SELECT xml, device_snapshot FROM diagram_version WHERE id = $1`,
      [version.id],
    );
    expect(rows[0].xml).toContain('label="Tủ E2E-MT-R1"');
    expect(rows[0].xml).not.toContain('Mặt sau');
    expect(rows[0].xml).toContain('ims_photo="front"');
    expect(rows[0].xml).not.toContain('data:image');
    // Bản chụp thiết bị lúc lưu có U (lệch kho so "vị trí … · U5–U6").
    expect(rows[0].device_snapshot.find((d) => d.id === srv)).toMatchObject({ u: 5, uSize: 2 });
    // Lần hai mà kho không đổi: mặt tủ dựng ra y hệt — không thêm phiên bản (Q-23 06/10), trả bản cũ.
    await expect(service.rebuildRack(SA.email, rack.id)).resolves.toMatchObject({ id: version.id, seq: 1, unchanged: true });
    // Kho đổi (máy đổi U) thì dựng lại là một phiên bản mới.
    await scratch.pool.query(`UPDATE device SET rack_u_start = 3 WHERE id = $1`, [sw]);
    try {
      await expect(service.rebuildRack(SA.email, rack.id)).resolves.toMatchObject({ seq: 2 });
    } finally {
      await scratch.pool.query(`UPDATE device SET rack_u_start = 1 WHERE id = $1`, [sw]);
    }

    const room = await service.create(SA.email, { name: 'E2E Phòng', nodeType: 'room' });
    await expect(service.rebuildRack(SA.email, room.id)).rejects.toMatchObject({ response: { code: 'DIAGRAM_NOT_CABINET' } });
  });

  it('"Dựng từ kho": tạo bản vẽ tủ kèm phiên bản nháp #1 là mặt tủ từ kho (Q-23 06/10 chiều)', async () => {
    const parent = await service.create(SA.email, { name: 'E2E Phòng dựng từ kho', nodeType: 'room' });
    const node = await service.createFromStock(SA.email, { name: 'E2E Tủ dựng từ kho', nodeType: 'cabinet', parentId: parent.id, siteId, cabinetId });
    expect(node).toMatchObject({ name: 'E2E Tủ dựng từ kho', nodeType: 'cabinet', cabinetId, parentId: parent.id });
    const { rows } = await scratch.pool.query<{ seq: number; summary: string; xml: string; svg: string | null; based_on_version_id: string | null }>(
      `SELECT seq, summary, xml, svg, based_on_version_id FROM diagram_version WHERE diagram_id = $1`,
      [node.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seq: 1, svg: null, based_on_version_id: null, summary: expect.stringContaining('Dựng từ kho E2E-MT-R1') });
    expect(rows[0].xml).toContain('label="Tủ E2E-MT-R1"');
    expect(rows[0].xml).toContain(`ims_device_id="${srv}"`);
    // Kho bản vẽ giữ XML khô (AD-18): ảnh chỉ ghép vào khi mở.
    expect(rows[0].xml).not.toContain('data:image');
    const history = await scratch.pool.query<{ action: string }>(`SELECT action FROM diagram_history WHERE diagram_id = $1 ORDER BY created_at, action`, [node.id]);
    expect(history.rows.map((r) => r.action).sort()).toEqual(['created', 'version.saved']);
  });

  it('"Dựng từ kho" chỉ cho bản vẽ cấp tủ có gắn tủ — từ chối thì không để lại bản vẽ rỗng', async () => {
    const count = async () => Number((await scratch.pool.query<{ n: string }>(`SELECT count(*) n FROM diagram WHERE name LIKE 'E2E Không tủ%'`)).rows[0].n);
    await expect(service.createFromStock(SA.email, { name: 'E2E Không tủ phòng', nodeType: 'room' })).rejects.toMatchObject({
      response: { code: 'DIAGRAM_NOT_CABINET' },
    });
    await expect(service.createFromStock(SA.email, { name: 'E2E Không tủ phòng có tủ', nodeType: 'room', siteId, cabinetId })).rejects.toMatchObject({
      response: { code: 'DIAGRAM_NOT_CABINET' },
    });
    await expect(service.createFromStock(SA.email, { name: 'E2E Không tủ chưa chọn', nodeType: 'cabinet', siteId })).rejects.toMatchObject({
      response: { code: 'DIAGRAM_NOT_CABINET' },
    });
    expect(await count()).toBe(0);
  });

  it('"Dựng lại mặt tủ" giữ id ô máy và dây đã khai giữa hai máy trên mặt tủ — dây không thành "không khớp" (Q-23 05/10)', async () => {
    const linkId = (
      await scratch.pool.query<{ id: string }>(
        `INSERT INTO device_port (device_id, port_label, connected_device_id, connected_port) VALUES ($1, 'Gi1/0/1', $2, 'eth0') RETURNING id`,
        [sw, srv],
      )
    ).rows[0].id;
    const rack = await service.create(SA.email, { name: 'E2E Tủ giữ dây', nodeType: 'cabinet', siteId, cabinetId });
    const first = await service.rebuildRack(SA.email, rack.id);
    const xml1 = (await scratch.pool.query<{ xml: string }>(`SELECT xml FROM diagram_version WHERE id = $1`, [first.id])).rows[0].xml;
    const idOf = (xml: string, deviceId: string) => [...xml.matchAll(new RegExp(`ims_device_id="${deviceId}"[^>]*id="([^"]+)"`, 'g'))].map((m) => m[1]);
    const [swFront] = idOf(xml1, sw);
    const [srvFront] = idOf(xml1, srv);
    // Người vẽ nối dây đã khai giữa hai máy trên mặt trước rồi lưu.
    const withCable = xml1.replace(
      '</root>',
      `<UserObject label="" ims_link_id="${linkId}" id="cap-1"><mxCell style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="${swFront}" target="${srvFront}"><mxGeometry relative="1" as="geometry"/></mxCell></UserObject></root>`,
    );
    const saved = await service.save(SA.email, rack.id, { xml: withCable, svg: SVG, basedOnVersionId: first.id });

    const rebuilt = await service.rebuildRack(SA.email, rack.id);
    const xml2 = (await scratch.pool.query<{ xml: string }>(`SELECT xml FROM diagram_version WHERE id = $1`, [rebuilt.id])).rows[0].xml;
    expect(idOf(xml2, sw)).toEqual(idOf(xml1, sw));
    expect(idOf(xml2, srv)).toEqual(idOf(xml1, srv));
    expect(xml2).toContain(`ims_link_id="${linkId}"`);
    expect(xml2).toMatch(new RegExp(`source="${swFront}"`));
    expect(rebuilt.summary).not.toContain('dây');
    const content = await service.content(SA.email, rack.id, { mode: 'view', versionId: rebuilt.id });
    expect(content.cableEdges?.find((e) => e.cellId === 'cap-1')).toMatchObject({ state: 'linked' });
    expect(saved.seq).toBe(2);
    // Bản dựng lại chưa có ảnh xem: lưu lại y nguyên vẫn tạo phiên bản (để có ảnh xem); lần sau mới là "không đổi gì".
    const same = xml2;
    const preview = await service.save(SA.email, rack.id, { xml: same, svg: SVG, basedOnVersionId: rebuilt.id });
    expect(preview).toMatchObject({ seq: 4, summary: 'Tạo ảnh xem cho bản dựng tự động' });
    expect(preview.unchanged).toBeUndefined();
    expect(await service.save(SA.email, rack.id, { xml: same, svg: SVG, basedOnVersionId: preview.id })).toMatchObject({ id: preview.id, unchanged: true });
    await scratch.pool.query(`DELETE FROM device_port WHERE id = $1`, [linkId]);
  });

  it('máy có U vượt chiều cao tủ (tủ bị hạ chiều cao sau khi khai — dữ liệu cũ): sang cột bên kèm cảnh báo, không vỡ khung', async () => {
    await scratch.pool.query(`UPDATE cabinet SET u_height = 4 WHERE id = $1`, [cabinetId]);
    try {
      const frame = await service.cabinetFrame(cabinetId);
      const srvCells = frame.layout.devices.filter((d) => d.code === 'SRV-E2E-MT-01');
      expect(srvCells.map((d) => d.frame)).toEqual(['unplaced']);
      expect(srvCells[0].label).toContain('⚠ U5–U6 vượt tủ E2E-MT-R1 (4U)');
      expect(frame.layout.frames.find((f) => f.key === 'rack')!.height).toBeLessThan(200);
      // Sửa ô khác của hồ sơ cũ vẫn được (luật vượt tủ chỉ xét khi đổi U/tủ) — kể cả khi form gửi
      // lại đủ mọi ô như web làm (tủ, U, trạng thái không đổi).
      await expect(devices.update(SA.email, srv, { note: 'E2E sửa ghi chú' })).resolves.toBeTruthy();
      await expect(
        devices.update(SA.email, srv, { note: 'E2E sửa lần hai', cabinetId, siteId, rackUStart: 5, rackUSize: 2, status: 'in_use' }),
      ).resolves.toBeTruthy();
      // Đổi U thì luật áp lại.
      await expect(devices.update(SA.email, srv, { cabinetId, siteId, rackUStart: 6, rackUSize: 2 })).rejects.toMatchObject({
        response: { code: 'DEVICE_RACK_U_INVALID' },
      });
    } finally {
      await scratch.pool.query(`UPDATE cabinet SET u_height = 12 WHERE id = $1`, [cabinetId]);
    }
    expect(pc).toBeTruthy();
  });

  it('lượt dọn E2E (vùng `devices` của reset-e2e.mjs) gỡ được máy có ảnh + ảnh model + hàng device_model', async () => {
    const source = readFileSync(join(__dirname, '..', 'scripts', 'reset-e2e.mjs'), 'utf8');
    const block = /\n {2}devices: \[([\s\S]*?)\n {2}\],/.exec(source);
    if (!block) throw new Error('Không tìm thấy vùng devices trong reset-e2e.mjs');
    const client = await scratch.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [, statement] of block[1].matchAll(/`([^`]+)`/g)) await client.query(statement);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const left = async (q: string) => (await scratch.pool.query<{ n: number }>(q)).rows[0].n;
    expect(await left(`SELECT count(*)::int AS n FROM device WHERE code ILIKE '%E2E%'`)).toBe(0);
    expect(await left(`SELECT count(*)::int AS n FROM device_model`)).toBe(0);
    expect(await left(`SELECT count(*)::int AS n FROM file WHERE owner_type IN ('device', 'device_model')`)).toBe(0);
  });
});
