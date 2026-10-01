import { runMigrations } from '../src/database/migration-runner';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DevicesApiService } from '../src/modules/devices/devices.api';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DisposalService } from '../src/modules/disposal/disposal.service';
import { ServiceAccountsApiService } from '../src/modules/service-accounts/service-accounts.api';
import { ServiceAccountService } from '../src/modules/service-accounts/service-account.service';
import { IspLineService } from '../src/modules/software/isp-line.service';
import { SoftwareApiService } from '../src/modules/software/software.api';
import { SoftwareService } from '../src/modules/software/software.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, seedIspProviders, type ScratchDb } from './db';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import type { UsersApiService } from '../src/modules/users/users.api';

/**
 * Kho thanh lý qua đủ bốn cửa THẬT của module chủ (AD-2), trên DB thật.
 *
 * Bài đơn vị `disposal.service.spec.ts` chỉ kiểm phần gộp — đồ giả trả gì nó nhận nấy, nên một
 * cửa `list*` quên truyền bộ lọc trạng thái vẫn xanh ở đó trong khi kho tràn hồ sơ đang dùng.
 * Ở đây mỗi loại có cả hồ sơ ngừng dùng lẫn hồ sơ còn sống, và chỉ loại trước được vào kho.
 */

const TEST_TIMEOUT = 120_000;

describe('Kho thanh lý — bốn nguồn, tầng DB', () => {
  let scratch: ScratchDb;
  let disposal: DisposalService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_disposal');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const catalog = new CatalogApiService(new CatalogService(db, audit));
    const devices = new DevicesService(
      db,
      catalog,
      audit,
      {} as DeviceRetirementRegistry,
      new DeviceSearchRegistry(),
    );
    const software = new SoftwareService(
      db,
      catalog,
      audit,
      {} as ExpiryApiService,
      {} as SystemConfigService,
    );
    const isp = new IspLineService(
      db,
      catalog,
      new DevicesApiService(devices),
      audit,
    );
    disposal = new DisposalService(
      new DevicesApiService(devices),
      new SoftwareApiService(software, isp),
      new ServiceAccountsApiService(new ServiceAccountService(db, audit, {} as ExpiryApiService)),
      {
        namesByEmails: (emails: string[]) =>
          Promise.resolve(
            new Map(emails.filter((e) => e === 'a@pmh.com.vn').map((e) => [e, 'Nguyễn Văn A'])),
          ),
      } as unknown as UsersApiService,
      { getString: () => Promise.resolve('Asia/Ho_Chi_Minh') } as unknown as SystemConfigService,
    );

    const pool = scratch.pool;
    const providers = await seedIspProviders(pool, ['VNPT', 'FPT', 'Viettel']);
    const type = await pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('Loại QA-01') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO device (code, name, device_type_id, status, updated_at) VALUES
         ('DSP-DEV-OLD', 'Máy đã bỏ', $1, 'retired', '2026-09-01T00:00:00Z'),
         ('DSP-DEV-LIVE', 'Máy đang dùng', $1, 'in_use', '2026-09-10T00:00:00Z'),
         ('DSP-DEV-BROKEN', 'Máy hỏng', $1, 'broken', '2026-09-10T00:00:00Z')`,
      [type.rows[0].id],
    );
    await pool.query(
      `INSERT INTO software (code, name, kind, status, updated_at) VALUES
         ('DSP-SW-OLD', 'Phần mềm đã bỏ', 'license', 'retired', '2026-09-04T00:00:00Z'),
         ('DSP-SW-LIVE', 'Phần mềm đang dùng', 'license', 'active', '2026-09-10T00:00:00Z'),
         ('DSP-SW-EXP', 'Hết hạn chấp nhận', 'ssl', 'expired_ok', '2026-09-10T00:00:00Z')`,
    );
    await pool.query(
      `INSERT INTO service_account (code, kind, name, status, created_by, updated_at) VALUES
         ('DSP-SA-OLD', 'vpn', 'TK đã khoá', 'disabled', 't', '2026-09-02T00:00:00Z'),
         ('DSP-SA-LIVE', 'shared', 'TK đang dùng', 'active', 't', '2026-09-10T00:00:00Z')`,
    );
    await pool.query(
      `INSERT INTO isp_line (code, provider, provider_id, bandwidth, status, updated_at) VALUES
         ('DSP-ISP-OLD', 'VNPT', $1, '1 Gbps', 'terminated', '2026-09-03T00:00:00Z'),
         ('DSP-ISP-LIVE', 'FPT', $2, null, 'active', '2026-09-10T00:00:00Z'),
         ('DSP-ISP-PAUSE', 'Viettel', $3, null, 'suspended', '2026-09-10T00:00:00Z')`,
      [providers.VNPT, providers.FPT, providers.Viettel],
    );

    /*
     * Lịch sử đưa vào kho — mỗi bảng lịch sử của đúng module chủ. Máy có HAI lần thanh lý (lần
     * cũ do z@, rồi khôi phục, rồi a@ thanh lý lại lúc 30/08 17:30 UTC = 31/08 giờ VN) và một
     * lần sửa ghi chú SAU đó không đổi trạng thái: chỉ lần chuyển sang `retired` mới nhất được
     * tính, và sửa ghi chú không dời ngày vào kho.
     */
    await pool.query(
      `INSERT INTO device_history (device_id, action, actor, changes, created_at)
       SELECT id, a.action, a.actor, a.changes::jsonb, a.at::timestamptz FROM device,
         (VALUES
           ('status-changed', 'z@pmh.com.vn', '{"status":{"before":"in_use","after":"retired"}}', '2026-05-01T03:00:00Z'),
           ('status-changed', 'z@pmh.com.vn', '{"status":{"before":"retired","after":"in_use"}}', '2026-06-01T03:00:00Z'),
           ('status-changed', 'A@pmh.com.vn', '{"status":{"before":"in_use","after":"retired"}}', '2026-08-30T17:30:00Z'),
           ('updated', 'b@pmh.com.vn', '{"note":{"before":null,"after":"x"}}', '2026-09-01T03:00:00Z')
         ) AS a(action, actor, changes, at)
       WHERE device.code = 'DSP-DEV-OLD'`,
    );
    await pool.query(
      `INSERT INTO software_history (software_id, action, actor, changes, created_at)
       SELECT id, 'auto-retired', 'system', '{"status":{"before":"expired_ok","after":"retired"}}', '2026-09-04T00:00:00Z'
       FROM software WHERE code = 'DSP-SW-OLD'`,
    );
    await pool.query(
      `INSERT INTO service_account_history (service_account_id, action, actor, changes, created_at)
       SELECT id, 'disabled', 'b@pmh.com.vn',
              '{"status":{"before":"active","after":"disabled"},"reason":{"before":null,"after":"Nhân viên nghỉ việc"}}',
              '2026-09-02T00:00:00Z'
       FROM service_account WHERE code = 'DSP-SA-OLD'`,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('chỉ hồ sơ ngừng dùng của mỗi loại vào kho, mới bỏ nhất lên đầu', async () => {
    const items = await disposal.list();
    expect(items.map((item) => [item.kind, item.code, item.status])).toEqual([
      ['software', 'DSP-SW-OLD', 'retired'],
      ['isp', 'DSP-ISP-OLD', 'terminated'],
      ['service_account', 'DSP-SA-OLD', 'disabled'],
      ['device', 'DSP-DEV-OLD', 'retired'],
    ]);
  });

  it('nhãn phụ lấy đúng nguồn: loại thiết bị, loại phần mềm, loại tài khoản, băng thông', async () => {
    const byKind = new Map((await disposal.list()).map((item) => [item.kind, item]));
    expect(byKind.get('device')).toMatchObject({ name: 'Máy đã bỏ', detail: 'Loại QA-01' });
    expect(byKind.get('software')).toMatchObject({ name: 'Phần mềm đã bỏ', detail: 'license' });
    expect(byKind.get('service_account')).toMatchObject({ name: 'TK đã khoá', detail: 'vpn' });
    expect(byKind.get('isp')).toMatchObject({ name: 'VNPT', detail: '1 Gbps' });
    for (const item of byKind.values()) expect(item.updatedAt).toBeInstanceOf(Date);
  });

  const Q = { sort: 'disposedAt', dir: 'desc', page: 1, limit: 50 } as const;

  it('DP-002: ai đưa vào kho, khi nào, tự động hay bằng tay, vì sao — đọc từ lịch sử module chủ', async () => {
    const { items } = await disposal.inventory(Q);
    const byCode = new Map(items.map((item) => [item.code, item]));
    expect(byCode.get('DSP-DEV-OLD')).toMatchObject({
      disposedAt: new Date('2026-08-30T17:30:00Z'),
      disposedBy: 'A@pmh.com.vn',
      disposedByName: 'Nguyễn Văn A',
      auto: false,
      reason: null,
    });
    expect(byCode.get('DSP-SW-OLD')).toMatchObject({
      disposedAt: new Date('2026-09-04T00:00:00Z'),
      disposedBy: 'system',
      auto: true,
    });
    expect(byCode.get('DSP-SA-OLD')).toMatchObject({
      disposedBy: 'b@pmh.com.vn',
      disposedByName: null,
      reason: 'Nhân viên nghỉ việc',
    });
    // Không có dòng lịch sử (nhập thẳng): lùi về ngày cập nhật, không bịa người làm.
    expect(byCode.get('DSP-ISP-OLD')).toMatchObject({
      disposedAt: new Date('2026-09-03T00:00:00Z'),
      disposedBy: null,
      auto: false,
    });
  });

  it('DP-004: lọc khoảng ngày vào kho theo giờ VN, sắp mới nhất trước, phân trang, đếm theo loại', async () => {
    const all = await disposal.inventory(Q);
    expect(all.items.map((item) => item.code)).toEqual([
      'DSP-SW-OLD',
      'DSP-ISP-OLD',
      'DSP-SA-OLD',
      'DSP-DEV-OLD',
    ]);
    expect(all.total).toBe(4);

    // 30/08 17:30 UTC là 31/08 giờ VN — "tháng 8" phải có máy đó, "tháng 9" thì không.
    const aug = await disposal.inventory({ ...Q, from: '2026-08-01', to: '2026-08-31' });
    expect(aug.items.map((item) => item.code)).toEqual(['DSP-DEV-OLD']);
    const sep = await disposal.inventory({ ...Q, from: '2026-09-01', to: '2026-09-30' });
    expect(sep.items.map((item) => item.code)).toEqual(['DSP-SW-OLD', 'DSP-ISP-OLD', 'DSP-SA-OLD']);
    expect(sep.counts).toEqual({ device: 0, software: 1, service_account: 1, isp: 1 });

    const page2 = await disposal.inventory({ ...Q, page: 2, limit: 3 });
    expect(page2.total).toBe(4);
    expect(page2.items.map((item) => item.code)).toEqual(['DSP-DEV-OLD']);
  });
});
