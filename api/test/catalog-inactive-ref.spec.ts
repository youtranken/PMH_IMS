import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { SoftwareService } from '../src/modules/software/software.service';
import { IspLineService } from '../src/modules/software/isp-line.service';
import { SubnetService } from '../src/modules/ipam/subnet.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';

/**
 * Q-14 (ADM-015, DEV-027) — mục danh mục đã vô hiệu KHÔNG chọn MỚI được ở mọi cửa ghi.
 *
 * Hai vế, và vế thứ hai quan trọng ngang vế đầu:
 *   1. Tạo mới, hoặc ĐỔI sang một mục đã vô hiệu → 400 `CATALOG_REF_INACTIVE`, câu tiếng Việt
 *      nêu tên mục.
 *   2. Hồ sơ VỐN trỏ vào mục đã vô hiệu vẫn sửa được các ô khác. Form gửi đủ mọi ô, kể cả ô
 *      không đổi, nên hàng rào mà chỉ nhìn giá trị gửi lên sẽ khoá chết hồ sơ cũ.
 */

const TEST_TIMEOUT = 120_000;
const actor = 'inactive-ref@test';
const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;
const noDevices = { getByIds: () => Promise.resolve(new Map()) } as unknown as DevicesApiService;
const config = {
  getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
} as unknown as SystemConfigService;

const INACTIVE = { response: { code: 'CATALOG_REF_INACTIVE' } };

describe('Q-14 · mục danh mục đã vô hiệu không chọn mới được', () => {
  let scratch: ScratchDb;
  let catalog: CatalogService;
  let devices: DevicesService;
  let software: SoftwareService;
  let isp: IspLineService;
  let subnets: SubnetService;
  const id: Record<string, string> = {};

  async function one(text: string, params: unknown[] = []): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(text, params);
    return rows[0].id;
  }

  async function retire(table: string, rowId: string): Promise<void> {
    await scratch.pool.query(`UPDATE ${table} SET active = false WHERE id = $1`, [rowId]);
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_catalog_inactive_ref');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    catalog = new CatalogService(scratch.db, audit);
    const api = new CatalogApiService(catalog);
    devices = new DevicesService(scratch.db, api, audit, noRetirement, new DeviceSearchRegistry());
    software = new SoftwareService(scratch.db, api, audit, {} as ExpiryApiService, config);
    isp = new IspLineService(scratch.db, api, noDevices, audit);
    subnets = new SubnetService(scratch.db, audit, api, new SystemConfigService(scratch.db));

    id.siteOn = await one(`INSERT INTO site (code, name) VALUES ('E2E-ON', 'Site dùng') RETURNING id`);
    id.siteOff = await one(`INSERT INTO site (code, name) VALUES ('E2E-OFF', 'Site cũ') RETURNING id`);
    id.cabOn = await one(`INSERT INTO cabinet (site_id, code) VALUES ($1, 'R01') RETURNING id`, [id.siteOn]);
    id.cabOff = await one(`INSERT INTO cabinet (site_id, code) VALUES ($1, 'R02') RETURNING id`, [id.siteOn]);
    id.typeOn = await one(`INSERT INTO device_type (name) VALUES ('PC E2E') RETURNING id`);
    id.typeOff = await one(`INSERT INTO device_type (name) VALUES ('Máy fax E2E') RETURNING id`);
    id.vendorOn = await one(`INSERT INTO vendor (name) VALUES ('NCC E2E') RETURNING id`);
    id.vendorOff = await one(`INSERT INTO vendor (name) VALUES ('NCC cũ E2E') RETURNING id`);
    id.provider = await one(`INSERT INTO isp_provider (name) VALUES ('FPT E2E') RETURNING id`);

    // Hồ sơ cũ dựng khi mục còn dùng — rồi mới vô hiệu, đúng như đời thực.
    id.oldDevice = (
      await devices.create(actor, {
        code: 'E2E-OLD-DEV',
        name: 'Máy cũ',
        deviceTypeId: id.typeOff,
        siteId: id.siteOff,
        vendorId: id.vendorOff,
      })
    ).device.id;
    id.oldDeviceCab = (
      await devices.create(actor, {
        code: 'E2E-OLD-CAB',
        name: 'Máy trong tủ cũ',
        deviceTypeId: id.typeOn,
        siteId: id.siteOn,
        cabinetId: id.cabOff,
      })
    ).device.id;
    id.oldSoftware = (
      await software.create(actor, { code: 'E2E-OLD-SW', name: 'PM cũ', kind: 'other', vendorId: id.vendorOff })
    ).id;
    id.oldSubnet = (
      await subnets.create(actor, { name: 'E2E dải cũ', cidr: '10.99.1.0/24', siteId: id.siteOff })
    ).id;
    id.oldIsp = (await isp.create(actor, { code: 'E2E-OLD-ISP', providerId: id.provider, siteId: id.siteOff })).id;
    id.oldCabinetInOff = await one(
      `INSERT INTO cabinet (site_id, code) VALUES ($1, 'R09') RETURNING id`,
      [id.siteOff],
    );

    await retire('site', id.siteOff);
    await retire('cabinet', id.cabOff);
    await retire('device_type', id.typeOff);
    await retire('vendor', id.vendorOff);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  describe('thiết bị', () => {
    it.each([
      ['loại', { deviceTypeId: 'typeOff' }, /Loại thiết bị "Máy fax E2E" đã ngừng dùng/],
      ['site', { siteId: 'siteOff' }, /Site "E2E-OFF" đã ngừng dùng/],
      ['nhà cung cấp', { vendorId: 'vendorOff' }, /Nhà cung cấp "NCC cũ E2E" đã ngừng dùng/],
      ['tủ', { siteId: 'siteOn', cabinetId: 'cabOff' }, /Tủ mạng "R02" đã ngừng dùng/],
    ])('tạo mới trỏ vào %s đã vô hiệu → 400 CATALOG_REF_INACTIVE', async (_label, refs, message) => {
      const input: Record<string, string> = { code: `E2E-NEW-${_label}`, name: 'Mới', deviceTypeId: id.typeOn };
      for (const [key, name] of Object.entries(refs)) input[key] = id[name];
      const error = await devices.create(actor, input).catch((e: unknown) => e);
      expect(error).toMatchObject(INACTIVE);
      expect((error as { message: string }).message).toMatch(message);
    });

    it('sửa máy khác, ĐỔI sang loại đã vô hiệu → 400', async () => {
      const created = await devices.create(actor, {
        code: 'E2E-DOI',
        name: 'Máy đổi',
        deviceTypeId: id.typeOn,
      });
      await expect(
        devices.update(actor, created.device.id, { deviceTypeId: id.typeOff }),
      ).rejects.toMatchObject(INACTIVE);
    });

    it('hồ sơ vốn trỏ vào mục đã vô hiệu: gửi lại đủ ô vẫn sửa được', async () => {
      const result = await devices.update(actor, id.oldDevice, {
        code: 'E2E-OLD-DEV',
        name: 'Máy cũ — đổi tên',
        deviceTypeId: id.typeOff,
        siteId: id.siteOff,
        cabinetId: '',
        vendorId: id.vendorOff,
      });
      expect(result.device.name).toBe('Máy cũ — đổi tên');

      const inCab = await devices.update(actor, id.oldDeviceCab, {
        siteId: id.siteOn,
        cabinetId: id.cabOff,
        note: 'vẫn trong tủ cũ',
      });
      expect(inCab.device.cabinetId).toBe(id.cabOff);
    });
  });

  describe('phần mềm', () => {
    it('tạo mới với NCC đã vô hiệu → 400; hồ sơ cũ giữ NCC đó vẫn sửa được', async () => {
      await expect(
        software.create(actor, { code: 'E2E-SW-NEW', name: 'PM', kind: 'other', vendorId: id.vendorOff }),
      ).rejects.toMatchObject(INACTIVE);
      const updated = await software.update(actor, id.oldSoftware, {
        name: 'PM cũ — sửa',
        vendorId: id.vendorOff,
      });
      expect(updated.name).toBe('PM cũ — sửa');
    });
  });

  describe('dải mạng', () => {
    it('tạo dải ở site đã vô hiệu → 400; dải cũ ở site đó vẫn sửa được', async () => {
      await expect(
        subnets.create(actor, { name: 'E2E dải mới', cidr: '10.99.2.0/24', siteId: id.siteOff }),
      ).rejects.toMatchObject(INACTIVE);
      const updated = await subnets.update(actor, id.oldSubnet, {
        name: 'E2E dải cũ — sửa',
        siteId: id.siteOff,
      });
      expect(updated.name).toBe('E2E dải cũ — sửa');
    });
  });

  describe('đường truyền', () => {
    it('tạo ở site đã vô hiệu → 400; đường cũ ở site đó vẫn sửa được', async () => {
      await expect(
        isp.create(actor, { code: 'E2E-ISP-NEW', providerId: id.provider, siteId: id.siteOff }),
      ).rejects.toMatchObject(INACTIVE);
      const updated = await isp.update(actor, id.oldIsp, {
        providerId: id.provider,
        siteId: id.siteOff,
        hotline: '1900 6600',
      });
      expect(updated.hotline).toBe('1900 6600');
    });
  });

  describe('tủ mạng (ô Thuộc site)', () => {
    it('tạo tủ ở site đã vô hiệu → 400; tủ cũ ở site đó vẫn sửa được', async () => {
      await expect(
        catalog.create(actor, 'cabinet', { code: 'R10', siteId: id.siteOff }),
      ).rejects.toMatchObject(INACTIVE);
      const renamed = await catalog.update(actor, 'cabinet', id.oldCabinetInOff, {
        code: 'R09B',
        siteId: id.siteOff,
      });
      expect((renamed as { code: string }).code).toBe('R09B');
    });

    it('dời tủ sang site đã vô hiệu → 400', async () => {
      await expect(
        catalog.update(actor, 'cabinet', id.cabOn, { siteId: id.siteOff }),
      ).rejects.toMatchObject(INACTIVE);
    });
  });
});
