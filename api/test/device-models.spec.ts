import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migration-runner';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { modelKey } from '../src/modules/devices/device-model-key';
import { DeviceModelsService } from '../src/modules/devices/device-models.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DevicePortsService } from '../src/modules/devices/device-ports.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Danh mục Model thiết bị (Q-26, migration 0061) trên Postgres thật: khoá chuẩn hoá chống model tách
 * đôi (kể cả hai lượt tạo cùng lúc), Gắn tủ ↔ Số U, số máy dùng, chặn xoá model còn máy, máy gán model
 * lấy loại + chuỗi model + Số U từ model, đổi Số U của model kiểm chồng U cho cả loạt máy.
 */
const TEST_TIMEOUT = 120_000;
const ACTOR = 'e2e-model@qa.test';

const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;

describe('Model thiết bị · danh mục (0061, Q-26)', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;
  let models: DeviceModelsService;
  let ports: DevicePortsService;
  let siteId: string;
  let cabinetId: string;
  let switchType: string;
  let printerType: string;

  const one = async (q: string, p: unknown[] = []) => (await scratch.pool.query<{ id: string }>(q, p)).rows[0].id;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_models');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = new AuditWriterService(scratch.db);
    const catalog = new CatalogApiService(new CatalogService(scratch.db, audit));
    devices = new DevicesService(scratch.db, catalog, audit, noRetirement, new DeviceSearchRegistry());
    models = new DeviceModelsService(scratch.db, catalog, audit, devices, new SystemConfigService(scratch.db));
    ports = new DevicePortsService(scratch.db, devices);
    siteId = await one(`INSERT INTO site (code, name) VALUES ('E2E-MD', 'Site model') RETURNING id`);
    cabinetId = await one(`INSERT INTO cabinet (site_id, code, u_height) VALUES ($1, 'E2E-MD-R1', 12) RETURNING id`, [siteId]);
    switchType = await one(`INSERT INTO device_type (name) VALUES ('Switch E2E MD') RETURNING id`);
    printerType = await one(`INSERT INTO device_type (name) VALUES ('Máy in E2E MD') RETURNING id`);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('khoá chuẩn hoá của Postgres (cột sinh) trùng hệt modelKey() của api', async () => {
    const samples = ['C9300-48P', 'c9300 48p', ' C9300_48P. ', 'FortiGate 60F', 'R740\txd', 'XG-430'];
    const { rows } = await scratch.pool.query<{ k: string }>(
      `SELECT upper(regexp_replace(m, '[[:space:]_.-]', '', 'g')) k FROM unnest($1::text[]) WITH ORDINALITY u(m, i) ORDER BY i`,
      [samples],
    );
    expect(rows.map((r) => r.k)).toEqual(samples.map(modelKey));
  });

  it('tạo model gắn tủ; gõ khác (hoa thường, khoảng trắng, gạch) cùng khoá → 409 nêu model sẵn có', async () => {
    const created = await models.create(ACTOR, { deviceTypeId: switchType, model: 'E2E-C9300-48P', manufacturer: 'Cisco', rackMountable: true, uSize: 1 });
    expect(created).toMatchObject({ model: 'E2E-C9300-48P', manufacturer: 'Cisco', rackMountable: true, uSize: 1, deviceCount: 0, deviceTypeName: 'Switch E2E MD' });
    await expect(models.create(ACTOR, { deviceTypeId: printerType, model: 'e2e c9300 48p', rackMountable: false })).rejects.toMatchObject({
      response: { code: 'DEVICE_MODEL_DUPLICATE', existing: { id: created.id, model: 'E2E-C9300-48P' } },
    });
  });

  it('lượt tạo đua lọt qua phép kiểm trước: UNIQUE của DB chặn, vẫn ra 409 kèm model sẵn có (không 500)', async () => {
    const first = await models.create(ACTOR, { deviceTypeId: switchType, model: 'E2E-RACE-1', rackMountable: false });
    // Giả lập lượt đua: phép kiểm trước của lượt sau chạy TRƯỚC khi lượt đầu commit, nên không thấy gì.
    const precheck = jest.spyOn(models as unknown as { assertUnique: () => Promise<void> }, 'assertUnique').mockResolvedValueOnce(undefined);
    await expect(models.create(ACTOR, { deviceTypeId: switchType, model: 'e2e race 1', rackMountable: false })).rejects.toMatchObject({
      response: { code: 'DEVICE_MODEL_DUPLICATE', existing: { id: first.id } },
    });
    precheck.mockRestore();
    expect(Number((await scratch.pool.query(`SELECT count(*) n FROM device_model WHERE model_key = 'E2ERACE1'`)).rows[0].n)).toBe(1);
  });

  it.each([
    [{ rackMountable: true }, /Số U/],
    [{ rackMountable: true, uSize: 61 }, /Số U/],
    [{ rackMountable: false, uSize: 2 }, /không gắn tủ/],
    [{ rackMountable: false, model: ' -- ' }, /Mã model/],
  ])('đặc tính sai %o → 400', async (extra, message) => {
    await expect(
      models.create(ACTOR, { deviceTypeId: switchType, model: `E2E-BAD-${Math.random().toString(36).slice(2, 7)}`, ...extra }),
    ).rejects.toMatchObject({ response: { message: expect.stringMatching(message) } });
  });

  it('máy gán model: loại, chuỗi model và Số U lấy từ model (máy không sửa đè Số U); danh sách đếm số máy', async () => {
    const model = await models.create(ACTOR, { deviceTypeId: switchType, model: 'E2E-SW-2U', rackMountable: true, uSize: 2 });
    const { device } = await devices.create(ACTOR, {
      code: 'SW-E2E-MD-A',
      name: 'Máy A',
      deviceTypeId: printerType,
      deviceModelId: model.id,
      siteId,
      cabinetId,
      rackUStart: 3,
      rackUSize: 7,
    });
    expect(device).toMatchObject({ deviceModelId: model.id, deviceTypeId: switchType, model: 'E2E-SW-2U', rackUStart: 3, rackUSize: 2 });
    // Chỉ đổi U bắt đầu: Số U vẫn theo model.
    const moved = await devices.update(ACTOR, device.id, { rackUStart: 5 });
    expect(moved.device).toMatchObject({ rackUStart: 5, rackUSize: 2 });
    const page = await models.list({ search: 'e2e sw 2u' }, { page: 1, limit: 20 });
    expect(page.items.find((m) => m.id === model.id)).toMatchObject({ deviceCount: 1 });
  });

  it('xoá model còn máy dùng → 409 nêu số máy; model chưa dùng xoá được', async () => {
    const used = await models.create(ACTOR, { deviceTypeId: switchType, model: 'E2E-USED', rackMountable: false });
    await devices.create(ACTOR, { code: 'SW-E2E-MD-USED', name: 'Máy dùng', deviceTypeId: switchType, deviceModelId: used.id });
    await expect(models.remove(ACTOR, used.id)).rejects.toMatchObject({ response: { code: 'DEVICE_MODEL_IN_USE', message: expect.stringContaining('1 máy') } });
    const unused = await models.create(ACTOR, { deviceTypeId: switchType, model: 'E2E-UNUSED', rackMountable: false });
    await models.remove(ACTOR, unused.id);
    expect(Number((await scratch.pool.query(`SELECT count(*) n FROM device_model WHERE id = $1`, [unused.id])).rows[0].n)).toBe(0);
  });

  it('đổi Số U của model: chồng U ở tủ → 409 kèm máy sẽ chồng, không ghi gì; không chồng thì cả loạt máy đổi theo', async () => {
    const model = await models.create(ACTOR, { deviceTypeId: switchType, model: 'E2E-GROW', rackMountable: true, uSize: 1 });
    const { device: grow } = await devices.create(ACTOR, { code: 'SW-E2E-MD-GROW', name: 'Máy lớn', deviceTypeId: switchType, deviceModelId: model.id, siteId, cabinetId, rackUStart: 9 });
    await devices.create(ACTOR, { code: 'SW-E2E-MD-ABOVE', name: 'Máy trên', deviceTypeId: switchType, siteId, cabinetId, rackUStart: 10, rackUSize: 1 });
    await expect(models.update(ACTOR, model.id, { uSize: 2 })).rejects.toMatchObject({
      response: { code: 'DEVICE_MODEL_U_CLASH', message: expect.stringContaining('SW-E2E-MD-GROW') },
    });
    expect((await scratch.pool.query(`SELECT u_size FROM device_model WHERE id = $1`, [model.id])).rows[0].u_size).toBe(1);
    await devices.update(ACTOR, grow.id, { rackUStart: 7 });
    await models.update(ACTOR, model.id, { uSize: 2 });
    expect((await scratch.pool.query(`SELECT rack_u_size FROM device WHERE id = $1`, [grow.id])).rows[0].rack_u_size).toBe(2);
    const [latest] = await devices.history(grow.id);
    expect(latest.changes).toMatchObject({ rackUSize: { before: 1, after: 2 } });
  });

  it('Truy cập quản trị: lưu danh sách sạch; sửa RIÊNG các dòng vẫn ghi và có lịch sử đọc được; sai → 400', async () => {
    const { device } = await devices.create(ACTOR, {
      code: 'SW-E2E-MD-ACC',
      name: 'Máy truy cập',
      deviceTypeId: switchType,
      accessPoints: [{ kind: 'web', address: ' 10.0.1.1 ', port: 443 }, { kind: 'ssh', address: '' }],
    });
    expect(device.accessPoints).toEqual([{ kind: 'web', address: '10.0.1.1', port: 443 }]);
    const updated = await devices.update(ACTOR, device.id, { accessPoints: [{ kind: 'web', address: '10.0.1.1', port: 443 }, { kind: 'ssh', address: '10.0.1.1', port: 22 }] });
    expect(updated.device.accessPoints).toHaveLength(2);
    const [latest] = await devices.history(device.id);
    expect(latest.changes).toMatchObject({ accessPoints: { before: 'Web 10.0.1.1:443', after: 'Web 10.0.1.1:443; SSH 10.0.1.1:22' } });
    // Gửi lại y hệt: không đổi gì, không thêm dòng lịch sử.
    await devices.update(ACTOR, device.id, { accessPoints: [{ kind: 'web', address: '10.0.1.1', port: 443 }, { kind: 'ssh', address: '10.0.1.1', port: 22 }] });
    expect((await devices.history(device.id)).length).toBe(2);
    await expect(devices.update(ACTOR, device.id, { accessPoints: [{ kind: 'ftp', address: 'x' }] })).rejects.toMatchObject({ response: { code: 'DEVICE_ACCESS_INVALID' } });
  });

  it('cổng mẫu (11.3): model sinh 52 cổng, máy gán model nhận đủ; đổi mẫu sau đó không đổi ngầm máy đã có; mẫu sai → 400', async () => {
    const template = [
      { pattern: 'Gi1/0/[1-48]', kind: 'rj45' },
      { pattern: 'Te1/1/[1-4]', kind: 'sfp+' },
    ];
    const model = await models.create(ACTOR, { deviceTypeId: switchType, model: 'E2E-SW-52', rackMountable: true, uSize: 1, portTemplate: template });
    expect(model).toMatchObject({ portCount: 52, portTemplate: template });
    const { device } = await devices.create(ACTOR, { code: 'SW-E2E-MD-52A', name: 'Switch 52', deviceTypeId: switchType, deviceModelId: model.id });
    expect(device.portLayout).toHaveLength(52);
    expect(device.portLayout[48]).toEqual({ label: 'Te1/1/1', kind: 'sfp+' });
    await models.update(ACTOR, model.id, { portTemplate: [{ pattern: 'Gi1/0/[1-24]', kind: 'rj45' }] });
    expect((await scratch.pool.query(`SELECT jsonb_array_length(port_layout) n FROM device WHERE id = $1`, [device.id])).rows[0].n).toBe(52);
    const { device: later } = await devices.create(ACTOR, { code: 'SW-E2E-MD-52B', name: 'Switch 24', deviceTypeId: switchType, deviceModelId: model.id });
    expect(later.portLayout).toHaveLength(24);
    await expect(models.create(ACTOR, { deviceTypeId: switchType, model: 'E2E-BAD-PORTS', rackMountable: false, portTemplate: [{ pattern: 'Port[8-1]', kind: 'rj45' }] })).rejects.toMatchObject({
      response: { code: 'PORT_TEMPLATE_INVALID' },
    });
  });

  it('mặt cổng (11.3): dây của máy này và dây máy khác cắm vào đều tính; bỏ cổng có dây bị chặn; khai dây vào cổng ngoài danh sách thì thêm làm cổng riêng; thẻ sơ đồ ra dùng/tổng', async () => {
    const model = await models.create(ACTOR, { deviceTypeId: switchType, model: 'E2E-SW-4', rackMountable: false, portTemplate: [{ pattern: 'p[1-4]', kind: 'rj45' }] });
    const { device: sw } = await devices.create(ACTOR, { code: 'SW-E2E-MD-P4', name: 'Switch 4', deviceTypeId: switchType, deviceModelId: model.id });
    const { device: pc } = await devices.create(ACTOR, { code: 'PC-E2E-MD-P', name: 'PC', deviceTypeId: switchType });
    const { device: ap } = await devices.create(ACTOR, { code: 'AP-E2E-MD-P', name: 'AP', deviceTypeId: switchType });
    await ports.link(ACTOR, sw.id, { portLabel: 'p1', connectedDeviceId: pc.id, connectedPort: 'eth0' });
    await ports.link(ACTOR, ap.id, { portLabel: 'lan', connectedDeviceId: sw.id, connectedPort: 'P2' });
    const panel = await ports.panel(sw.id);
    expect(panel).toMatchObject({ used: 2, total: 4, unlisted: [] });
    expect(panel.ports.map((p) => [p.label, p.peer])).toEqual([
      ['p1', 'PC-E2E-MD-P · eth0'],
      ['p2', 'AP-E2E-MD-P · lan'],
      ['p3', null],
      ['p4', null],
    ]);
    await expect(ports.setLayout(ACTOR, sw.id, [{ label: 'p2', kind: 'rj45' }, { label: 'p3', kind: 'rj45' }], 256)).rejects.toMatchObject({
      response: { code: 'PORT_LAYOUT_IN_USE', message: expect.stringContaining('p1') },
    });
    const trimmed = await ports.setLayout(ACTOR, sw.id, [{ label: 'p1', kind: 'rj45' }, { label: 'p2', kind: 'rj45' }, { label: 'p3', kind: 'rj45' }], 256);
    expect(trimmed.total).toBe(3);
    // Cổng ngoài danh sách: khai dây xong thì nó thành cổng riêng của máy.
    await ports.link(ACTOR, sw.id, { portLabel: 'mgmt', connectedDeviceId: ap.id, connectedPort: 'eth9' });
    const after = await ports.panel(sw.id);
    expect(after.ports.map((p) => `${p.label}/${p.kind}`)).toEqual(['p1/rj45', 'p2/rj45', 'p3/rj45', 'mgmt/other']);
    // Máy không có danh sách cổng (AP) giữ cách cũ: không tự sinh danh sách.
    expect((await ports.panel(ap.id)).total).toBe(0);
    expect((await ports.portUsage([sw.id])).get(sw.id)).toEqual({ used: 3, declared: 4 });
  });

  it('lượt dọn E2E (vùng devices của reset-e2e.mjs) gỡ được máy trỏ model bằng khoá ngoại', async () => {
    const model = await models.create(ACTOR, { deviceTypeId: switchType, model: 'E2E-CLEAN', rackMountable: false });
    await devices.create(ACTOR, { code: 'SW-E2E-MD-CLEAN', name: 'Máy dọn', deviceTypeId: switchType, deviceModelId: model.id });
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
    const left = async (q: string) => Number((await scratch.pool.query<{ n: string }>(q)).rows[0].n);
    expect(await left(`SELECT count(*) n FROM device WHERE code ILIKE '%E2E%'`)).toBe(0);
    expect(await left(`SELECT count(*) n FROM device_model WHERE model ILIKE '%E2E%'`)).toBe(0);
  });

  it('máy thuộc model KHÔNG gắn tủ: gắn tủ hay khai U bị từ chối 400 gắn vào ô Tủ (11.2, Q-23 06/10 E.21)', async () => {
    const printer = await models.create(ACTOR, { deviceTypeId: printerType, model: 'E2E-PRINTER', rackMountable: false });
    await expect(
      devices.create(ACTOR, { code: 'PR-E2E-MD-A', name: 'Máy in', deviceTypeId: printerType, deviceModelId: printer.id, siteId, cabinetId }),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_MODEL_NOT_RACKABLE' } });
    const { device } = await devices.create(ACTOR, { code: 'PR-E2E-MD-B', name: 'Máy in', deviceTypeId: printerType, deviceModelId: printer.id, siteId });
    expect(device).toMatchObject({ cabinetId: null, rackUStart: null });
    // Máy đang trong tủ (chưa có Model) đổi sang model không gắn tủ cũng bị chặn.
    const { device: racked } = await devices.create(ACTOR, { code: 'PR-E2E-MD-C', name: 'Máy in', deviceTypeId: printerType, siteId, cabinetId });
    await expect(devices.update(ACTOR, racked.id, { deviceModelId: printer.id })).rejects.toMatchObject({ response: { code: 'DEVICE_MODEL_NOT_RACKABLE' } });
  });

  it('model không gắn tủ → bỏ gắn tủ thì Số U bỏ theo; model đổi sang không gắn tủ khi còn máy trong tủ → 409', async () => {
    const model = await models.create(ACTOR, { deviceTypeId: switchType, model: 'E2E-FLIP', rackMountable: true, uSize: 1 });
    await devices.create(ACTOR, { code: 'SW-E2E-MD-FLIP', name: 'Máy lật', deviceTypeId: switchType, deviceModelId: model.id, siteId, cabinetId, rackUStart: 1 });
    await expect(models.update(ACTOR, model.id, { rackMountable: false, uSize: null })).rejects.toMatchObject({ response: { code: 'DEVICE_MODEL_IN_RACK' } });
  });
});
