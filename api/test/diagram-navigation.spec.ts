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
import { DiagramNavigationService } from '../src/modules/diagrams/diagram-navigation.service';
import { DiagramsService } from '../src/modules/diagrams/diagrams.service';
import type { IpamApiService } from '../src/modules/ipam/ipam.api';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Tìm, lớp và chỉ đường của trình xem sơ đồ trên Postgres thật: đường đi dò sơ đồ cổng THẬT
 * (`device_port` qua `devices.api`), trần số dây đọc từ `system_config`, "bản vẽ chứa máy" đọc chỉ
 * mục ô của phiên bản mới nhất, và nội dung bản vẽ trả lớp + ô cho trình xem.
 */

const TEST_TIMEOUT = 180_000;
const SA = 'e2e-diagram-nav@qa.test';

const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;

function deviceCell(id: string, deviceId: string, code: string, x: number): string {
  return `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="${id}"><mxCell style="rounded=1;" vertex="1" parent="1"><mxGeometry x="${x}" y="10" width="100" height="40" as="geometry"/></mxCell></UserObject>`;
}

describe('Sơ đồ mạng · tìm, lớp, chỉ đường', () => {
  let scratch: ScratchDb;
  let service: DiagramsService;
  let navigation: DiagramNavigationService;
  let ports: DevicePortsService;
  let config: SystemConfigService;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    scratch = await createScratchDb('ims_diagram_nav');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const audit = new AuditWriterService(db);
    const catalog = new CatalogApiService(new CatalogService(db, audit));
    const devicesService = new DevicesService(db, catalog, audit, noRetirement, new DeviceSearchRegistry());
    ports = new DevicePortsService(db, devicesService);
    const devices = new DevicesApiService(devicesService, ports);
    const ipam = { heldAddressesOf: (list: string[]) => Promise.resolve(new Map(list.map((id) => [id, []]))) } as unknown as IpamApiService;
    config = new SystemConfigService(db);
    service = new DiagramsService(db, audit, config, catalog, devices, ipam, new UsersApiService(new UsersService(db)));
    navigation = new DiagramNavigationService(db, config, devices);

    await scratch.pool.query(`INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, 'E2E Trực đêm', 'sa', 'x')`, [SA]);
    const typeId = (await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('Switch E2E NAV') RETURNING id`)).rows[0].id;
    // Chuỗi PC — SW-TANG — SW-LOI — FW — ISP; LAP đứng riêng không dây nào.
    for (const code of ['PC-E2E-NAV', 'SW-TANG-E2E-NAV', 'SW-LOI-E2E-NAV', 'FW-E2E-NAV', 'ISP-E2E-NAV', 'LAP-E2E-NAV']) {
      ids[code] = (
        await scratch.pool.query<{ id: string }>(`INSERT INTO device (code, name, device_type_id) VALUES ($1::text, $1::text, $2) RETURNING id`, [code, typeId])
      ).rows[0].id;
    }
    const chain = ['PC-E2E-NAV', 'SW-TANG-E2E-NAV', 'SW-LOI-E2E-NAV', 'FW-E2E-NAV', 'ISP-E2E-NAV'];
    for (let i = 0; i + 1 < chain.length; i += 1) {
      await ports.link(SA, ids[chain[i]], { portLabel: `up${i}`, connectedDeviceId: ids[chain[i + 1]], connectedPort: `down${i}` });
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('chỉ đường PC → ISP: đủ 5 máy theo thứ tự, 4 dây, mỗi máy kèm bản vẽ chứa nó', async () => {
    const floor = await service.create(SA, { name: 'E2E Tầng 3', nodeType: 'floor' });
    await service.save(SA, floor.id, {
      xml: `<mxfile><diagram id="p1" name="T"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${deviceCell('a', ids['PC-E2E-NAV'], 'PC-E2E-NAV', 0)}${deviceCell('b', ids['SW-TANG-E2E-NAV'], 'SW-TANG-E2E-NAV', 200)}</root></mxGraphModel></diagram></mxfile>`,
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      basedOnVersionId: null,
    });
    const result = await navigation.path(ids['PC-E2E-NAV'], ids['ISP-E2E-NAV']);
    expect(result.path?.hops.map((h) => h.code)).toEqual(['PC-E2E-NAV', 'SW-TANG-E2E-NAV', 'SW-LOI-E2E-NAV', 'FW-E2E-NAV', 'ISP-E2E-NAV']);
    expect(result.path?.linkIds).toHaveLength(4);
    expect(result.path?.hops[0].diagrams).toEqual([{ id: floor.id, name: 'E2E Tầng 3' }]);
    expect(result.path?.hops[2].diagrams).toEqual([]);
  });

  it('máy không dây nào → path null (web báo "Không có đường nối")', async () => {
    const result = await navigation.path(ids['PC-E2E-NAV'], ids['LAP-E2E-NAV']);
    expect(result).toMatchObject({ from: { code: 'PC-E2E-NAV' }, to: { code: 'LAP-E2E-NAV' }, path: null });
  });

  it('xa hơn `diagram.path_max_hops` → coi như không có đường', async () => {
    await scratch.pool.query(`UPDATE system_config SET value = '3' WHERE key = 'diagram.path_max_hops'`);
    config.forget('diagram.path_max_hops');
    try {
      expect((await navigation.path(ids['PC-E2E-NAV'], ids['ISP-E2E-NAV'])).path).toBeNull();
      expect((await navigation.path(ids['PC-E2E-NAV'], ids['FW-E2E-NAV'])).path?.linkIds).toHaveLength(3);
    } finally {
      await scratch.pool.query(`UPDATE system_config SET value = '12' WHERE key = 'diagram.path_max_hops'`);
      config.forget('diagram.path_max_hops');
    }
  });

  it('máy không có trong kho → 404', async () => {
    await expect(navigation.path(ids['PC-E2E-NAV'], '7b0c1c1e-0000-4000-8000-0000000000ff')).rejects.toMatchObject({ status: 404 });
  });

  it('tìm theo mã: máy + bản vẽ chính thức chứa nó; không khớp → rỗng; quá ngắn → 400', async () => {
    const found = await navigation.find('sw-tang-e2e');
    expect(found).toEqual([{ id: ids['SW-TANG-E2E-NAV'], code: 'SW-TANG-E2E-NAV', name: 'SW-TANG-E2E-NAV', diagrams: [{ id: expect.any(String), name: 'E2E Tầng 3' }] }]);
    expect(await navigation.find('KHONG-CO-E2E-NAV')).toEqual([]);
    await expect(navigation.find(' x ')).rejects.toMatchObject({ status: 400 });
  });

  it('nội dung trả lớp draw.io (tên từ XML) + ô kèm lớp và khung bao', async () => {
    const node = await service.create(SA, { name: 'E2E Lớp', nodeType: 'room' });
    await service.save(SA, node.id, {
      xml: `<mxfile><diagram id="p1" name="T"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="L2" value="Camera" parent="0"/>${deviceCell('a', ids['PC-E2E-NAV'], 'PC-E2E-NAV', 0)}<mxCell id="cam" value="Cam 1" vertex="1" parent="L2"><mxGeometry x="300" y="10" width="40" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`,
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      basedOnVersionId: null,
    });
    const content = await service.content(SA, node.id, { mode: 'view' });
    expect(content.layers).toEqual([
      { id: '1', name: '' },
      { id: 'L2', name: 'Camera' },
    ]);
    expect(content.cells).toEqual([
      { id: 'a', kind: 'device', layer: '1', bounds: { x: 0, y: 10, width: 100, height: 40 } },
      { id: 'cam', kind: 'shape', layer: 'L2', bounds: { x: 300, y: 10, width: 40, height: 40 } },
    ]);
  });
});
