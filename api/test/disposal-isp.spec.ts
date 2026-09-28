import { runMigrations } from '../src/database/migration-runner';
import { DisposalService } from '../src/modules/disposal/disposal.service';
import { IspLineService } from '../src/modules/software/isp-line.service';
import { SoftwareApiService } from '../src/modules/software/software.api';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { ServiceAccountsApiService } from '../src/modules/service-accounts/service-accounts.api';
import type { SoftwareService } from '../src/modules/software/software.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { UsersApiService } from '../src/modules/users/users.api';
import { createScratchDb, migrationsDir, seedIspProviders, type ScratchDb } from './db';

/**
 * Q-10 — đường truyền đã thanh lý vào Kho thanh lý, đọc qua cửa `software.api` (AD-2).
 *
 * Tầng DB vì câu cần hỏi là "bộ lọc trạng thái có thật sự chạy trong câu SQL không": đồ giả
 * trả gì thì bài đơn vị nhận nấy, nên một cửa quên truyền `status` vẫn xanh ở đó trong khi
 * kho tràn cả đường truyền đang chạy.
 */

const TEST_TIMEOUT = 120_000;

describe('Q-10 · đường truyền thanh lý vào kho — tầng DB', () => {
  let scratch: ScratchDb;
  let isp: IspLineService;
  let api: SoftwareApiService;
  const actor = 'q10@test';
  let providers: Record<string, string>;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_disposal_isp');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    providers = await seedIspProviders(scratch.pool, ['VNPT', 'FPT', 'Viettel']);
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const catalog = new CatalogApiService(new CatalogService(scratch.db, audit));
    const devices = { getByIds: () => Promise.resolve(new Map()) } as unknown as DevicesApiService;
    isp = new IspLineService(scratch.db, catalog, devices, audit);
    api = new SoftwareApiService({} as SoftwareService, isp);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('chỉ đường truyền Thanh lý đi qua cửa; Đang dùng và Tạm ngưng ở lại màn Đường truyền', async () => {
    const running = await isp.create(actor, { code: 'Q10-RUN', providerId: providers.VNPT });
    const paused = await isp.create(actor, { code: 'Q10-PAUSE', providerId: providers.FPT });
    const cut = await isp.create(actor, { code: 'Q10-CUT', providerId: providers.Viettel, bandwidth: '1 Gbps' });
    await isp.update(actor, paused.id, { status: 'suspended' });
    await isp.update(actor, cut.id, { status: 'terminated' });

    const codes = (await api.listTerminatedIsp()).map((line) => line.code);
    expect(codes).toEqual(['Q10-CUT']);
    expect(codes).not.toContain(running.code);
  });

  it('kho gộp đường truyền thanh lý thành một hàng loại `isp`', async () => {
    const devices = { listRetired: () => Promise.resolve([]) } as unknown as DevicesApiService;
    const accounts = {
      listDisabled: () => Promise.resolve([]),
    } as unknown as ServiceAccountsApiService;
    // Phần mềm đã bỏ đi qua `software.list` — bảng đó không phải thứ bài này hỏi.
    const software = {
      listRetired: () => Promise.resolve([]),
      listTerminatedIsp: () => api.listTerminatedIsp(),
    } as unknown as SoftwareApiService;
    const disposal = new DisposalService(
      devices,
      software,
      accounts,
      {} as UsersApiService,
      {} as SystemConfigService,
    );

    const items = await disposal.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'isp',
      code: 'Q10-CUT',
      name: 'Viettel',
      detail: '1 Gbps',
      status: 'terminated',
    });
    expect(items[0].updatedAt).toBeInstanceOf(Date);
  });

  it('DP-002: ai thanh lý đường truyền đọc từ `isp_line_history` qua cửa software.api', async () => {
    const [line] = await api.listTerminatedIsp();
    const events = await api.ispTerminationEvents([line.id]);
    expect(events.get(line.id)).toMatchObject({ by: actor, auto: false });
    expect(events.get(line.id)?.at).toBeInstanceOf(Date);
  });
});
