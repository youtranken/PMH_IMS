import { NotFoundException } from '@nestjs/common';
import { runMigrations } from '../src/database/migration-runner';
import { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DevicePortsService } from '../src/modules/devices/device-ports.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { createScratchDb, migrationsDir, waitForLock, type ScratchDb } from './db';

/**
 * OLD-BE-03 — lịch sử cổng chỉ được ghi khi hàng THẬT SỰ bị sửa/xoá.
 *
 * Dòng port map có thể bị gỡ giữa lúc đọc và lúc ghi (hai người cùng mở trang thiết bị). Ghi
 * lịch sử "đã sửa/đã gỡ" cho một câu UPDATE/DELETE không chạm hàng nào là để lại một dòng
 * lịch sử nói dối — và lượt gỡ thứ hai còn báo thành công.
 */

const TEST_TIMEOUT = 120_000;
const actor = 'oldbe03@test';

describe('OLD-BE-03 · port map không ghi lịch sử cho hàng không còn', () => {
  let scratch: ScratchDb;
  let ports: DevicePortsService;
  let typeId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_port_write_check');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const devices = new DevicesService(
      scratch.db,
      {} as CatalogApiService,
      audit,
      new DeviceRetirementRegistry(),
      new DeviceSearchRegistry(),
    );
    ports = new DevicePortsService(scratch.db, devices);
    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('Switch OLD-BE-03') RETURNING id`,
    );
    typeId = type.rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function device(code: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id) VALUES ($1::text, $1::text, $2) RETURNING id`,
      [code, typeId],
    );
    return rows[0].id;
  }

  async function actions(deviceId: string): Promise<string[]> {
    const { rows } = await scratch.pool.query<{ action: string }>(
      `SELECT action FROM device_history WHERE device_id = $1 ORDER BY created_at, id`,
      [deviceId],
    );
    return rows.map((row) => row.action);
  }

  /** Một phiên khác gỡ dòng cổng và GIỮ khoá cho tới khi lượt ghi của service đã phải chờ. */
  async function deletedUnderneath(portId: string, write: () => Promise<unknown>) {
    const other = await scratch.pool.connect();
    try {
      await other.query('BEGIN');
      await other.query('DELETE FROM device_port WHERE id = $1', [portId]);
      const pending = write().then(
        () => undefined,
        (error: unknown) => error,
      );
      await waitForLock(scratch.pool);
      await other.query('COMMIT');
      return await pending;
    } finally {
      other.release();
    }
  }

  it('sửa một dòng vừa bị người khác gỡ → 404, không ghi "port-updated"', async () => {
    const sw = await device('SW-W1');
    const port = await ports.create(actor, sw, { portLabel: 'Gi1/0/1' });
    const error = await deletedUnderneath(port.id, () =>
      ports.update(actor, sw, port.id, { note: 'đổi ghi chú' }),
    );
    expect(error).toBeInstanceOf(NotFoundException);
    expect(await actions(sw)).toEqual(['port-added']);
  });

  it('gỡ một dòng vừa bị người khác gỡ → 404, không ghi "port-removed"', async () => {
    const sw = await device('SW-W2');
    const port = await ports.create(actor, sw, { portLabel: 'Gi1/0/2' });
    const error = await deletedUnderneath(port.id, () => ports.remove(actor, sw, port.id));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(await actions(sw)).toEqual(['port-added']);
  });

  it('lưu lại y nguyên (không đổi ô nào) thì không ghi lịch sử', async () => {
    const sw = await device('SW-W3');
    const port = await ports.create(actor, sw, { portLabel: 'Gi1/0/3', vlan: '20' });
    await ports.update(actor, sw, port.id, { portLabel: 'Gi1/0/3', vlan: '20', note: '' });
    expect(await actions(sw)).toEqual(['port-added']);
  });

  it('dòng của thiết bị KHÁC thì 404 dù id có thật', async () => {
    const sw = await device('SW-W4');
    const other = await device('SW-W4-OTHER');
    const port = await ports.create(actor, other, { portLabel: 'Gi1/0/4' });
    await expect(ports.remove(actor, sw, port.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ports.update(actor, sw, port.id, { note: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await actions(other)).toEqual(['port-added']);
  });
});
