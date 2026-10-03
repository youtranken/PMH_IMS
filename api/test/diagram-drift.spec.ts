import { runMigrations } from '../src/database/migration-runner';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { MailContentRegistry } from '../src/common/mail-content.registry';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { DevicePortsService } from '../src/modules/devices/device-ports.service';
import { DevicesApiService } from '../src/modules/devices/devices.api';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DiagramDriftService } from '../src/modules/diagrams/diagram-drift.service';
import { DiagramsService } from '../src/modules/diagrams/diagrams.service';
import type { IpamApiService } from '../src/modules/ipam/ipam.api';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Cảnh báo lệch kho trên Postgres thật (Q-23): bản chụp lúc lưu ghi cổng của dây, mở bản chính
 * thức thì số lệch vào bộ đệm cho cây mà không đụng mốc báo, lượt quét hằng ngày chỉ gửi thư khi
 * số TĂNG, mỗi ngày một lượt, và hai worker quét cùng lúc chỉ ra MỘT thư (khử job đúp).
 */

const TEST_TIMEOUT = 180_000;
const OWNER = { email: 'e2e-drift-owner@qa.test', fullName: 'E2E Người phụ trách' };
const MAKER = { email: 'e2e-drift-maker@qa.test', fullName: 'E2E Người vẽ' };
/** 03/10/2026 09:00 giờ Việt Nam — sau giờ quét mặc định 7. */
const DAY1 = new Date('2026-10-03T02:00:00Z');
const DAY2 = new Date('2026-10-04T02:00:00Z');
const DAY3 = new Date('2026-10-05T02:00:00Z');
const DAY4 = new Date('2026-10-06T02:00:00Z');

const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;
const noopSweep = { register: () => undefined } as unknown as SweepService;

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function deviceCell(id: string, deviceId: string, code: string, x = 0): string {
  return `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="${id}"><mxCell vertex="1" parent="1"><mxGeometry x="${x}" y="0" width="100" height="40" as="geometry"/></mxCell></UserObject>`;
}

function linkEdge(id: string, source: string, target: string, linkId: string): string {
  return `<UserObject label="" ims_link_id="${linkId}" id="${id}"><mxCell edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell></UserObject>`;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="d1"><rect width="10" height="10"/></g></svg>';

describe('Sơ đồ mạng · cảnh báo lệch kho (Q-23)', () => {
  let scratch: ScratchDb;
  let diagrams: DiagramsService;
  let mails: MailContentRegistry;
  let deps: {
    audit: AuditWriterService;
    devices: DevicesApiService;
    ipam: IpamApiService;
    users: UsersApiService;
  };
  let drift: DiagramDriftService;
  const ips = new Map<string, string[]>();
  let siteId: string;
  let typeId: string;
  let seq = 0;

  function newDrift(config = new SystemConfigService(scratch.db)): DiagramDriftService {
    const service = new DiagramDriftService(
      scratch.db,
      deps.audit,
      config,
      deps.devices,
      deps.ipam,
      new OutboxService(scratch.db, config, noopSweep),
      deps.users,
      mails,
      noopSweep,
    );
    service.onModuleInit();
    return service;
  }

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: number }>(sql, params);
    return rows[0].n;
  }

  async function newDevice(code: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id, site_id) VALUES ($1, $4, $2, $3) RETURNING id`,
      [code, typeId, siteId, code],
    );
    return rows[0].id;
  }

  /** Bản vẽ đã có bản chính thức = phiên bản vừa lưu. */
  async function official(name: string, body: string): Promise<{ diagramId: string; versionId: string }> {
    seq += 1;
    const diagram = await diagrams.create(MAKER.email, { name: `E2E Lệch ${name} ${seq}`, nodeType: 'room', ownerEmail: OWNER.email });
    const version = await diagrams.save(MAKER.email, diagram.id, { xml: page(body), svg: SVG, basedOnVersionId: null });
    await scratch.pool.query(`UPDATE diagram SET official_version_id = $2 WHERE id = $1`, [diagram.id, version.id]);
    return { diagramId: diagram.id, versionId: version.id };
  }

  const driftMails = (diagramId: string) =>
    count(`SELECT count(*)::int AS n FROM outbox WHERE topic = 'diagram.drift' AND payload->>'diagramId' = $1`, [diagramId]);

  beforeAll(async () => {
    scratch = await createScratchDb('ims_diagram_drift');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const audit = new AuditWriterService(db);
    const config = new SystemConfigService(db);
    const catalog = new CatalogApiService(new CatalogService(db, audit));
    const devicesService = new DevicesService(db, catalog, audit, noRetirement, new DeviceSearchRegistry());
    const devices = new DevicesApiService(devicesService, new DevicePortsService(db, devicesService));
    const ipam = {
      heldAddressesOf: (ids: string[]) => Promise.resolve(new Map(ids.map((id) => [id, ips.get(id) ?? []]))),
    } as unknown as IpamApiService;
    const users = new UsersApiService(new UsersService(db));
    deps = { audit, devices, ipam, users };
    mails = new MailContentRegistry();
    diagrams = new DiagramsService(db, audit, config, catalog, devices, ipam, users);
    for (const user of [OWNER, MAKER]) {
      await scratch.pool.query(`INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, 'member', 'x')`, [
        user.email,
        user.fullName,
      ]);
    }
    siteId = (await scratch.pool.query<{ id: string }>(`INSERT INTO site (code, name) VALUES ('E2E-DR', 'Site lệch') RETURNING id`)).rows[0].id;
    typeId = (await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('Switch E2E DR') RETURNING id`)).rows[0].id;
    drift = newDrift();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('lưu chụp cổng của dây vào bản chụp; đổi cổng sau khi vẽ → DRIFT_PORT trên nét', async () => {
    const sw = await newDevice('SW-E2E-DR-P');
    const srv = await newDevice('SRV-E2E-DR-P');
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_port (device_id, port_label, connected_device_id, connected_port) VALUES ($1, 'Gi0/1', $2, 'eth0') RETURNING id`,
      [sw, srv],
    );
    const linkId = rows[0].id;
    const { diagramId, versionId } = await official(
      'Cổng',
      deviceCell('d1', sw, 'SW-E2E-DR-P') + deviceCell('d2', srv, 'SRV-E2E-DR-P', 200) + linkEdge('e1', 'd1', 'd2', linkId),
    );
    const snapshot = (await scratch.pool.query<{ s: { id: string; ports?: Record<string, string> }[] }>(
      `SELECT device_snapshot AS s FROM diagram_version WHERE id = $1`,
      [versionId],
    )).rows[0].s;
    expect(snapshot.find((e) => e.id === sw)?.ports).toEqual({ [linkId]: 'Gi0/1' });
    expect(snapshot.find((e) => e.id === srv)?.ports).toEqual({ [linkId]: 'eth0' });

    expect(await drift.forVersion(diagramId, versionId)).toEqual([]);
    await scratch.pool.query(`UPDATE device_port SET port_label = 'Gi0/2' WHERE id = $1`, [linkId]);
    const found = await drift.forVersion(diagramId, versionId);
    expect(found).toEqual([
      expect.objectContaining({ code: 'DRIFT_PORT', cellId: 'e1', message: 'Dây SW-E2E-DR-P ↔ SRV-E2E-DR-P: cổng Gi0/1 ↔ eth0 → Gi0/2 ↔ eth0' }),
    ]);
  });

  it('mở bản chính thức ghi số lệch cho cây, KHÔNG đụng mốc báo; mở phiên bản khác thì không ghi', async () => {
    const dev = await newDevice('SW-E2E-DR-OPEN');
    ips.set(dev, ['10.0.1.5']);
    const { diagramId, versionId } = await official('Mở', deviceCell('d1', dev, 'SW-E2E-DR-OPEN'));
    ips.set(dev, ['10.0.1.9']);
    const found = await drift.forVersion(diagramId, versionId);
    expect(found).toEqual([expect.objectContaining({ code: 'DRIFT_IP', cellId: 'd1', message: 'Thiết bị SW-E2E-DR-OPEN: IP 10.0.1.5 → 10.0.1.9' })]);
    expect((await drift.counts([diagramId])).get(diagramId)).toBe(1);
    expect(await count(`SELECT notified_count AS n FROM diagram_drift WHERE diagram_id = $1`, [diagramId])).toBe(0);

    // Lưu phiên bản mới (chưa phát hành): mở nó không đổi bộ đệm của bản chính thức.
    const draft = await diagrams.save(MAKER.email, diagramId, { xml: page(deviceCell('d1', dev, 'SW-E2E-DR-OPEN')), svg: SVG, basedOnVersionId: versionId });
    expect(await drift.forVersion(diagramId, draft.id)).toEqual([]);
    expect((await drift.counts([diagramId])).get(diagramId)).toBe(1);

    // Phát hành phiên bản mới: số cũ tính trên bản chính thức cũ không còn hiện trên cây.
    await scratch.pool.query(`UPDATE diagram SET official_version_id = $2 WHERE id = $1`, [diagramId, draft.id]);
    expect((await drift.counts([diagramId])).get(diagramId)).toBeUndefined();
  });

  it('quét hằng ngày: thư khi số tăng, không gửi lại khi số không đổi, mỗi ngày một lượt, thư tới người phụ trách', async () => {
    const a = await newDevice('SW-E2E-DR-SW');
    const b = await newDevice('SW-E2E-DR-SW2');
    ips.set(a, ['10.0.2.5']);
    ips.set(b, ['10.0.2.6']);
    const { diagramId } = await official('Quét', deviceCell('d1', a, 'SW-E2E-DR-SW') + deviceCell('d2', b, 'SW-E2E-DR-SW2', 200));

    // Chưa lệch: quét không gửi gì nhưng vẫn chốt lượt hôm nay.
    await drift.sweepDue(DAY1);
    expect(await driftMails(diagramId)).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM diagram_drift WHERE diagram_id = $1 AND swept_at IS NOT NULL`, [diagramId])).toBe(1);

    // Thanh lý một máy → ngày sau số 0 → 1: một thư + nhật ký.
    await scratch.pool.query(`UPDATE device SET status = 'retired' WHERE id = $1`, [a]);
    await drift.sweepDue(DAY2);
    expect(await driftMails(diagramId)).toBe(1);
    const { rows } = await scratch.pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox WHERE topic = 'diagram.drift' AND payload->>'diagramId' = $1`,
      [diagramId],
    );
    expect(rows[0].payload).toEqual({ diagramId, count: 1, previous: 0 });
    expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'diagram.drift_notified' AND object_id = $1`, [diagramId])).toBe(1);

    // Cùng ngày quét lại: không gì. Ngày sau số không đổi: không gửi lại.
    await drift.sweepDue(new Date(DAY2.getTime() + 3_600_000));
    await drift.sweepDue(DAY3);
    expect(await driftMails(diagramId)).toBe(1);

    // Số tăng (đổi IP máy kia) → thư thứ hai, ghi "lần trước".
    ips.set(b, ['10.0.2.99']);
    await drift.sweepDue(DAY4);
    expect(await driftMails(diagramId)).toBe(2);

    // Mỗi ngày một lượt: số tăng tiếp trong ngày thì đợi lượt hôm sau, không gửi dồn trong ngày.
    const cabinet = (await scratch.pool.query<{ id: string }>(`INSERT INTO cabinet (code, site_id) VALUES ('E2E-DR-C', $1) RETURNING id`, [siteId]))
      .rows[0].id;
    await scratch.pool.query(`UPDATE device SET cabinet_id = $2 WHERE id = $1`, [b, cabinet]);
    await drift.sweepDue(new Date(DAY4.getTime() + 3_600_000));
    expect(await driftMails(diagramId)).toBe(2);
    await drift.sweepDue(new Date(DAY4.getTime() + 86_400_000));
    expect(await driftMails(diagramId)).toBe(3);

    // Nội dung thư dựng lại từ id: tới người phụ trách, nói tên bản vẽ và số mục.
    const mail = await mails.find('diagram.drift')!({ diagramId, count: 2, previous: 1 });
    expect(mail).toMatchObject({
      to: [OWNER.email],
      subject: expect.stringContaining('lệch kho: 2 mục'),
      ctaPath: `/diagrams/${diagramId}`,
    });
  });

  it('trước giờ quét không làm gì; tắt `diagram.drift_notify_enabled` thì vẫn ghi số nhưng không gửi thư', async () => {
    const dev = await newDevice('SW-E2E-DR-OFF');
    const { diagramId } = await official('Tắt', deviceCell('d1', dev, 'SW-E2E-DR-OFF'));
    await scratch.pool.query(`UPDATE device SET status = 'retired' WHERE id = $1`, [dev]);

    // 05:00 giờ Việt Nam, trước giờ quét 7.
    await drift.sweepDue(new Date('2026-10-07T22:00:00Z'));
    expect(await count(`SELECT count(*)::int AS n FROM diagram_drift WHERE diagram_id = $1`, [diagramId])).toBe(0);

    await scratch.pool.query(`UPDATE system_config SET value = '0' WHERE key = 'diagram.drift_notify_enabled'`);
    try {
      await newDrift().sweepDue(new Date('2026-10-08T02:00:00Z'));
      expect(await driftMails(diagramId)).toBe(0);
      expect(await count(`SELECT drift_count AS n FROM diagram_drift WHERE diagram_id = $1`, [diagramId])).toBe(1);
    } finally {
      await scratch.pool.query(`UPDATE system_config SET value = '1' WHERE key = 'diagram.drift_notify_enabled'`);
    }
  });

  it('hai worker quét cùng lúc một bản vẽ → đúng MỘT thư (khoá hàng là trọng tài)', async () => {
    const dev = await newDevice('SW-E2E-DR-RACE');
    const { diagramId } = await official('Đua', deviceCell('d1', dev, 'SW-E2E-DR-RACE'));
    await scratch.pool.query(`UPDATE device SET status = 'retired' WHERE id = $1`, [dev]);
    const at = new Date('2026-10-09T02:00:00Z');
    await Promise.all([newDrift().sweepDue(at), newDrift().sweepDue(at), newDrift().sweepDue(at)]);
    expect(await driftMails(diagramId)).toBe(1);
  });

  it('bản vẽ lưu trữ hay chưa phát hành không bị quét; người phụ trách không còn tài khoản → thư bỏ', async () => {
    const dev = await newDevice('SW-E2E-DR-ARCH');
    const { diagramId } = await official('Lưu trữ', deviceCell('d1', dev, 'SW-E2E-DR-ARCH'));
    await scratch.pool.query(`UPDATE device SET status = 'retired' WHERE id = $1`, [dev]);
    await diagrams.archive(MAKER.email, diagramId);
    await drift.sweepDue(new Date('2026-10-10T02:00:00Z'));
    expect(await driftMails(diagramId)).toBe(0);
    expect(await mails.find('diagram.drift')!({ diagramId, count: 1, previous: 0 })).toBeNull();
  });
});
