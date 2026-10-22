import { runMigrations } from '../src/database/migration-runner';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { IpAddressService } from '../src/modules/ipam/ip-address.service';
import { NatRuleService } from '../src/modules/ipam/nat-rule.service';
import type { SubnetService } from '../src/modules/ipam/subnet.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * FM-24 (Q-33): lượt Sửa không đổi gì thì API BỎ QUA — không ghi nhật ký, không ghi lịch sử rỗng.
 * Form gửi lại đủ mọi ô (kể cả ô không đụng tới), nên "bấm Lưu mà không sửa gì" là chuyện hằng
 * ngày; mỗi lần như vậy đẻ ra một dòng "đã sửa" rỗng là làm loãng tab Lịch sử và nhật ký.
 * Lượt CÓ đổi vẫn ghi như cũ. Thiết bị, phần mềm, đường truyền, tài khoản dịch vụ đã bỏ qua từ
 * trước; bài này chốt ba sổ còn lại: danh mục, IP, NAT.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.sua@pmh.com.vn';

describe('Sửa không đổi gì thì không ghi (FM-24)', () => {
  let scratch: ScratchDb;
  const audit = { appendWithin: jest.fn().mockResolvedValue(undefined) };
  let catalog: CatalogService;
  let addresses: IpAddressService;
  let nat: NatRuleService;
  let subnetId: string;
  let routerId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_no_op_update');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const writer = audit as unknown as AuditWriterService;
    catalog = new CatalogService(scratch.db, writer);
    const devices = {
      assertUsableWithin: () => Promise.resolve(),
      getByIds: () => Promise.resolve(new Map()),
    } as unknown as DevicesApiService;
    const subnets = {
      cidrOf: () => Promise.resolve('172.20.1.0/24'),
    } as unknown as SubnetService;
    const config = new SystemConfigService(scratch.db);
    addresses = new IpAddressService(scratch.db, writer, devices, subnets, config);
    nat = new NatRuleService(
      scratch.db,
      writer,
      devices,
      { findByIds: () => Promise.resolve(new Map()) } as unknown as IpAddressService,
      {} as CatalogApiService,
      config,
    );

    const subnet = await scratch.pool.query<{ id: string }>(
      `INSERT INTO subnet (name, cidr, created_by) VALUES ('Dai sua', '172.20.1.0/24', $1) RETURNING id`,
      [ACTOR],
    );
    subnetId = subnet.rows[0].id;
    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('Router sua') RETURNING id`,
    );
    const router = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id, status)
       VALUES ('RT-E2E-SUA', 'Draytek', $1, 'in_use') RETURNING id`,
      [type.rows[0].id],
    );
    routerId = router.rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(() => audit.appendWithin.mockClear());

  const auditActions = () =>
    audit.appendWithin.mock.calls.map((call) => (call[1] as { action: string }).action);

  async function count(sql: string, params: unknown[]): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: string }>(sql, params);
    return Number(rows[0].n);
  }

  it('danh mục: lưu lại nguyên form → không lịch sử, không nhật ký; đổi tên → ghi', async () => {
    const input = { name: 'NCC sửa E2E', phone: '028 1234 5678', contact: 'Chị Hoa', supplies: null };
    const created = await catalog.create(ACTOR, 'vendor', input);
    audit.appendWithin.mockClear();
    const updatedCount = () =>
      count(`SELECT count(*) AS n FROM catalog_history WHERE entity_id = $1 AND action = 'updated'`, [
        created.id,
      ]);

    const same = await catalog.update(ACTOR, 'vendor', created.id, { ...input });
    expect(same).toMatchObject({ id: created.id, name: 'NCC sửa E2E' });
    expect(await updatedCount()).toBe(0);
    expect(auditActions()).toEqual([]);

    await catalog.update(ACTOR, 'vendor', created.id, { ...input, name: 'NCC đã đổi E2E' });
    expect(await updatedCount()).toBe(1);
    expect(auditActions()).toEqual(['catalog.vendor.updated']);
  });

  it('hồ sơ IP: lưu lại nguyên form → không lịch sử, không nhật ký; đổi ghi chú → ghi', async () => {
    const ip = await addresses.create(ACTOR, {
      subnetId,
      address: '172.20.1.7',
      usedBy: 'Kho',
      assignedAt: '2026-10-01',
      note: 'tủ tầng 1',
    });
    audit.appendWithin.mockClear();
    const form = { deviceId: '', usedBy: 'Kho', assignedAt: '2026-10-01', note: 'tủ tầng 1' };
    const updatedCount = () =>
      count(`SELECT count(*) AS n FROM ip_history WHERE ip_address_id = $1 AND action = 'ip.updated'`, [
        ip.id,
      ]);

    const same = await addresses.update(ACTOR, ip.id, form);
    expect(same).toMatchObject({ id: ip.id, usedBy: 'Kho', note: 'tủ tầng 1' });
    expect(await updatedCount()).toBe(0);
    expect(auditActions()).toEqual([]);

    await addresses.update(ACTOR, ip.id, { ...form, note: 'tủ tầng 2' });
    expect(await updatedCount()).toBe(1);
    expect(auditActions()).toEqual(['ip.updated']);
  });

  it('luật NAT: lưu lại nguyên form → không lịch sử, không nhật ký; đổi lý do → ghi', async () => {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO nat_rule (device_id, protocol, external_from, external_to, internal_ip, internal_port, used_by, reason, created_by)
       VALUES ($1, 'tcp', 8443, 8443, '172.20.1.9', 443, 'IT', 'Web nội bộ', $2) RETURNING id`,
      [routerId, ACTOR],
    );
    const id = rows[0].id;
    const form = {
      deviceId: routerId,
      protocol: 'tcp' as const,
      externalFrom: 8443,
      externalTo: 8443,
      internalIp: '172.20.1.9',
      internalPort: 443,
      usedBy: 'IT',
      reason: 'Web nội bộ',
      enabled: true,
      note: null,
    };
    const historyCount = () =>
      count(`SELECT count(*) AS n FROM nat_rule_history WHERE nat_rule_id = $1`, [id]);

    const same = await nat.update(ACTOR, id, form);
    expect(same).toMatchObject({ id, reason: 'Web nội bộ' });
    expect(await historyCount()).toBe(0);
    expect(auditActions()).toEqual([]);

    await nat.update(ACTOR, id, { ...form, reason: 'Web nội bộ mới' });
    expect(await historyCount()).toBe(1);
    expect(auditActions()).toEqual(['nat.updated']);
  });
});
