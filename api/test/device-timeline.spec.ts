import { runMigrations } from '../src/database/migration-runner';
import { DeviceTimelineRegistry } from '../src/common/device-timeline.registry';
import { IpDeviceTimeline } from '../src/modules/ipam/ip-device-timeline';
import { LicenseDeviceTimeline } from '../src/modules/software/license-device-timeline';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * DEV-086 — dòng thời gian hợp nhất của thiết bị đọc đúng hai bảng chủ trên DB thật.
 *
 * Bài đơn vị `ip-device-timeline.spec` canh phần diễn giải một dòng; ở đây là câu SQL: ba hình
 * dạng `changes` của `ip_history` phải cùng lọt qua bộ lọc JSON, IP của máy KHÁC không lọt, và
 * ghế license cho hai sự kiện gán/gỡ.
 */

const TEST_TIMEOUT = 120_000;

describe('DEV-086 · dòng thời gian thiết bị — tầng DB', () => {
  let scratch: ScratchDb;
  let registry: DeviceTimelineRegistry;
  let deviceId: string;
  let otherId: string;

  async function one(text: string, params: unknown[] = []): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(text, params);
    return rows[0].id;
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_timeline');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const type = await one(`INSERT INTO device_type (name) VALUES ('PC E2E tl') RETURNING id`);
    deviceId = await one(
      `INSERT INTO device (code, name, device_type_id, status) VALUES ('PC-E2E-TL', 'Máy', $1, 'in_use') RETURNING id`,
      [type],
    );
    otherId = await one(
      `INSERT INTO device (code, name, device_type_id, status) VALUES ('PC-E2E-TL2', 'Máy 2', $1, 'in_use') RETURNING id`,
      [type],
    );
    const subnet = await one(
      `INSERT INTO subnet (name, cidr, created_by) VALUES ('Dải E2E tl', '10.78.1.0/24', 'test') RETURNING id`,
    );
    const ipA = await one(
      `INSERT INTO ip_address (subnet_id, address, status, assigned_by) VALUES ($1, '10.78.1.5', 'free', 'test') RETURNING id`,
      [subnet],
    );
    const ipB = await one(
      `INSERT INTO ip_address (subnet_id, address, status, assigned_by, device_id) VALUES ($1, '10.78.1.6', 'assigned', 'test', $2) RETURNING id`,
      [subnet, otherId],
    );
    const history = (ip: string, action: string, changes: unknown, at: string) =>
      scratch.pool.query(
        `INSERT INTO ip_history (ip_address_id, action, actor, changes, created_at)
         VALUES ($1, $2, 'it@pmh.com.vn', $3::jsonb, $4)`,
        [ip, action, JSON.stringify(changes), at],
      );
    // .5: tạo cho máy → sửa hồ sơ chuyển sang máy khác → thu hồi (không còn liên quan).
    await history(ipA, 'ip.created', { address: '10.78.1.5', deviceId }, '2026-09-01T01:00:00Z');
    await history(ipA, 'ip.updated', { deviceId: { before: deviceId, after: otherId } }, '2026-09-02T01:00:00Z');
    await history(ipA, 'ip.released', { previousDeviceId: otherId, deviceId: null }, '2026-09-03T01:00:00Z');
    // .6: chỉ của máy khác — không được lọt vào.
    await history(ipB, 'ip.created', { address: '10.78.1.6', deviceId: otherId }, '2026-09-01T02:00:00Z');

    const software = await one(
      `INSERT INTO software (code, name, kind, license_model, seat_total, end_date, status)
       VALUES ('LIC-E2E-TL', 'Office', 'license', 'subscription', 5, '2030-01-01', 'active') RETURNING id`,
    );
    await scratch.pool.query(
      `INSERT INTO license_assignment (software_id, device_id, assigned_by, assigned_at, released_at, released_by)
       VALUES ($1, $2, 'a@pmh.com.vn', '2026-08-01T01:00:00Z', '2026-09-04T01:00:00Z', 'b@pmh.com.vn')`,
      [software, deviceId],
    );

    registry = new DeviceTimelineRegistry();
    new IpDeviceTimeline(registry, scratch.db).onModuleInit();
    new LicenseDeviceTimeline(registry, scratch.db).onModuleInit();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it(
    'IP về/rời máy + ghế license gán/gỡ, mới nhất lên đầu; IP của máy khác không lọt',
    async () => {
      const { items, failedSources } = await registry.timelineFor(deviceId, 200);
      expect(failedSources).toEqual([]);
      expect(items.map((row) => [row.source, row.action, row.subject])).toEqual([
        ['software', 'license-released', 'LIC-E2E-TL'],
        ['ipam', 'ip-released', '10.78.1.5'],
        ['ipam', 'ip-assigned', '10.78.1.5'],
        ['software', 'license-assigned', 'LIC-E2E-TL'],
      ]);
      expect(items[1].link).toMatch(/^\/ip-addresses\/.+\?ip=10\.78\.1\.5$/);
      expect(items[0].actor).toBe('b@pmh.com.vn');
    },
    TEST_TIMEOUT,
  );

  it(
    'máy kia chỉ thấy phần của nó',
    async () => {
      const { items } = await registry.timelineFor(otherId, 200);
      expect(items.map((row) => [row.action, row.subject])).toEqual([
        ['ip-released', '10.78.1.5'],
        ['ip-assigned', '10.78.1.5'],
        ['ip-assigned', '10.78.1.6'],
      ]);
    },
    TEST_TIMEOUT,
  );
});
