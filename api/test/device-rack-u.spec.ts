import { BadRequestException, ConflictException } from '@nestjs/common';
import { runMigrations } from '../src/database/migration-runner';
import { DevicesService } from '../src/modules/devices/devices.service';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Vị trí U trong tủ (0054) trên Postgres thật: 1–60, không vượt chiều cao tủ, chồng U trong cùng
 * tủ bị chặn kèm tên máy đang chiếm (Q-23) — kể cả hai lượt ghi cùng lúc (khoá theo tủ + ràng
 * buộc `device_rack_u_no_overlap`), máy thanh lý không giữ chỗ, lịch sử ghi đổi U.
 */
const TEST_TIMEOUT = 120_000;
const ACTOR = 'e2e-rack-u@qa.test';

const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;

describe('Thiết bị · vị trí U trong tủ (0054, Q-23 chồng U thì chặn)', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;
  let siteId: string;
  let cabinetId: string;
  let otherCabinetId: string;
  let typeId: string;

  const one = async (q: string, p: unknown[] = []) => (await scratch.pool.query<{ id: string }>(q, p)).rows[0].id;
  const create = (code: string, extra: Record<string, unknown> = {}) =>
    devices.create(ACTOR, { code, name: `Máy ${code}`, deviceTypeId: typeId, siteId, cabinetId, ...extra });

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_rack_u');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = new AuditWriterService(scratch.db);
    devices = new DevicesService(scratch.db, new CatalogApiService(new CatalogService(scratch.db, audit)), audit, noRetirement, new DeviceSearchRegistry());
    siteId = await one(`INSERT INTO site (code, name) VALUES ('E2E-RU', 'Site U') RETURNING id`);
    cabinetId = await one(`INSERT INTO cabinet (site_id, code, u_height) VALUES ($1, 'E2E-RU-R1', 12) RETURNING id`, [siteId]);
    otherCabinetId = await one(`INSERT INTO cabinet (site_id, code, u_height) VALUES ($1, 'E2E-RU-R2', 12) RETURNING id`, [siteId]);
    typeId = await one(`INSERT INTO device_type (name) VALUES ('Switch E2E RU') RETURNING id`);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('lưu U hợp lệ, lịch sử ghi thay đổi U', async () => {
    const { device } = await create('SW-E2E-RU-A', { rackUStart: 5, rackUSize: 2 });
    expect(device).toMatchObject({ rackUStart: 5, rackUSize: 2 });
    await devices.update(ACTOR, device.id, { rackUStart: 7, rackUSize: 2 });
    const [latest] = await devices.history(device.id);
    expect(latest.changes).toMatchObject({ rackUStart: { before: 5, after: 7 } });
    await devices.update(ACTOR, device.id, { rackUStart: 5, rackUSize: 2 });
  });

  it('chồng U với máy khác cùng tủ → 409 nêu tên máy đang chiếm; tủ khác thì được', async () => {
    const attempt = create('SW-E2E-RU-B', { rackUStart: 6, rackUSize: 1 });
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(create('SW-E2E-RU-B', { rackUStart: 6, rackUSize: 1 })).rejects.toMatchObject({
      response: { code: 'DEVICE_RACK_U_TAKEN', message: expect.stringContaining('SW-E2E-RU-A (Máy SW-E2E-RU-A)') },
    });
    const { device } = await create('SW-E2E-RU-B', { rackUStart: 6, rackUSize: 1, cabinetId: otherCabinetId });
    expect(device.rackUStart).toBe(6);
  });

  it('sửa chính máy đang giữ U không tự chặn mình', async () => {
    const { device } = await create('SW-E2E-RU-SELF', { rackUStart: 1, rackUSize: 1 });
    await expect(devices.update(ACTOR, device.id, { rackUStart: 1, rackUSize: 2 })).resolves.toBeTruthy();
  });

  it.each([
    [{ rackUStart: 11, rackUSize: 3 }, /vượt tủ E2E-RU-R1 \(12U\)/],
    [{ rackUStart: 3, rackUSize: null }, /cùng có hoặc cùng trống/],
    [{ rackUStart: 3, rackUSize: 1, cabinetId: '' }, /chọn tủ/],
  ])('U sai %o → 400', async (extra, message) => {
    const attempt = create(`SW-E2E-RU-BAD-${Math.random().toString(36).slice(2, 7)}`, extra);
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toMatchObject({ response: { message: expect.stringMatching(message) } });
  });

  it('bỏ tủ thì U được xoá theo', async () => {
    const { device } = await create('SW-E2E-RU-MOVE', { rackUStart: 10, rackUSize: 1 });
    const { device: moved } = await devices.update(ACTOR, device.id, { cabinetId: '' });
    expect(moved).toMatchObject({ cabinetId: null, rackUStart: null, rackUSize: null });
  });

  it('hai lượt ghi CÙNG LÚC tranh một U: đúng một lượt qua, lượt kia 409 có tên máy', async () => {
    const results = await Promise.allSettled([
      create('SW-E2E-RU-RACE-1', { rackUStart: 12, rackUSize: 1 }),
      create('SW-E2E-RU-RACE-2', { rackUStart: 12, rackUSize: 1 }),
      create('SW-E2E-RU-RACE-3', { rackUStart: 12, rackUSize: 1 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(r.reason).toBeInstanceOf(ConflictException);
      expect((r.reason as ConflictException).getResponse()).toMatchObject({
        code: 'DEVICE_RACK_U_TAKEN',
        message: expect.stringMatching(/SW-E2E-RU-RACE-\d/),
      });
    }
  });

  it('ràng buộc DB là lưới cuối: ghi thẳng bỏ qua service vẫn bị chặn', async () => {
    await expect(
      scratch.pool.query(
        `INSERT INTO device (code, name, device_type_id, site_id, cabinet_id, rack_u_start, rack_u_size)
         VALUES ('SW-E2E-RU-RAW', 'raw', $1, $2, $3, 5, 1)`,
        [typeId, siteId, cabinetId],
      ),
    ).rejects.toMatchObject({ code: '23P01' });
    const id = await one(`INSERT INTO device (code, name, device_type_id, site_id, cabinet_id) VALUES ('SW-E2E-RU-RAW2', 'raw', $1, $2, $3) RETURNING id`, [
      typeId,
      siteId,
      cabinetId,
    ]);
    const attempt = scratch.db.transaction((tx) => devices.updateWithin(tx, id, { rackUStart: 5, rackUSize: 1 }));
    await expect(attempt).rejects.toMatchObject({ response: { code: 'DEVICE_RACK_U_TAKEN' } });
  });

  it('máy thanh lý không giữ chỗ; đưa lại vào dùng khi chỗ đã có máy khác → 409', async () => {
    const { device: old } = await create('SW-E2E-RU-OLD', { rackUStart: 3, rackUSize: 1 });
    await devices.setStatus(ACTOR, old.id, 'retired');
    const { device: fresh } = await create('SW-E2E-RU-NEW', { rackUStart: 3, rackUSize: 1 });
    expect(fresh.rackUStart).toBe(3);
    await expect(devices.setStatus(ACTOR, old.id, 'in_use')).rejects.toMatchObject({
      response: { code: 'DEVICE_RACK_U_TAKEN', message: expect.stringContaining('SW-E2E-RU-NEW') },
    });
  });

  it('CHECK cặp U: một cột có một cột trống bị DB từ chối', async () => {
    await expect(
      scratch.pool.query(
        `INSERT INTO device (code, name, device_type_id, site_id, cabinet_id, rack_u_start) VALUES ('SW-E2E-RU-PAIR', 'x', $1, $2, $3, 4)`,
        [typeId, siteId, cabinetId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
