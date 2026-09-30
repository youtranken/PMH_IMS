import { randomUUID } from 'node:crypto';
import { runMigrations } from '../src/database/migration-runner';
import { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import type { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import type { OwnerExistsRegistry } from '../src/common/owner-exists.registry';
import { ApprovalsApiService } from '../src/modules/approvals/approvals.api';
import { ApprovalsService } from '../src/modules/approvals/approvals.service';
import type { AuditApiService } from '../src/modules/audit/audit.api';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { AuthApiService } from '../src/modules/auth/auth.api';
import type { AuthedRequest } from '../src/modules/auth/types';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import type { UsersApiService } from '../src/modules/users/users.api';
import type { AccessListService } from '../src/modules/vault/access-list.service';
import type { AccessTier } from '../src/modules/vault/access-tier';
import { BreakGlassService } from '../src/modules/vault/break-glass.service';
import { VaultController } from '../src/modules/vault/vault.controller';
import type { VaultOwnersService } from '../src/modules/vault/vault-owners.service';
import { VaultService } from '../src/modules/vault/vault.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Ghi chú của ngăn két chỉ đến tay người MỞ ĐƯỢC ngăn đó (SEC-20, Q-18).
 *
 * Đòn gốc: người thử gõ mật khẩu vào ghi chú; ghi chú là cột dạng rõ và danh sách két mở cho cả
 * Member "cần duyệt" (để họ biết phải xin gì). Thế là Member đọc được mật khẩu mà không qua
 * duyệt, không mã 6 số, không dòng "đã xem" nào trong nhật ký.
 *
 * Chạy qua `VaultController.list` trên Postgres thật với phiếu duyệt thật — quyền "đang mở được"
 * là đúng thứ `BreakGlassService` đọc từ bảng `approval`, không phải một cờ giả.
 */

const TEST_TIMEOUT = 120_000;
const NOTE = 'Gọi NOC trước khi reboot';

describe('Két: ghi chú chỉ lộ cho người mở được ngăn (SEC-20)', () => {
  let scratch: ScratchDb;
  let vault: VaultService;
  let approvals: ApprovalsService;
  let breakGlass: BreakGlassService;
  let controller: VaultController;
  let tier: AccessTier = 'denied';

  beforeAll(async () => {
    scratch = await createScratchDb('ims_vault_note_exposure');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const crypto = {
      seal: () => ({
        ciphertext: Buffer.from('ct'),
        iv: Buffer.alloc(12, 1),
        tag: Buffer.alloc(16, 1),
        wrappedDek: Buffer.alloc(60, 1),
        keyVersion: 1,
      }),
    } as unknown as EnvelopeCryptoService;
    const audit = {
      appendWithin: () => Promise.resolve(),
      append: () => Promise.resolve(),
    } as unknown as AuditWriterService;
    const owners = {
      assertExists: () => Promise.resolve(),
      assertUsableWithin: () => Promise.resolve(),
    } as unknown as OwnerExistsRegistry;
    vault = new VaultService(scratch.db, crypto, audit, owners);

    const kinds = new ApprovalKindRegistry();
    approvals = new ApprovalsService(scratch.db, audit, kinds);
    const config = {
      getNumber: (key: string) =>
        Promise.resolve(key === 'dashboardSecretStaleDays' ? 180 : 24),
    } as unknown as SystemConfigService;
    const noopSweep = { register: () => undefined } as unknown as SweepService;
    breakGlass = new BreakGlassService(
      scratch.db,
      kinds,
      new ApprovalsApiService(approvals),
      { tierFor: () => Promise.resolve(tier) } as unknown as AccessListService,
      config,
      new OutboxService(scratch.db, config, noopSweep),
      {} as VaultOwnersService,
      {} as VaultService,
      {} as UsersApiService,
      { isSessionAlive: () => Promise.resolve(true) } as unknown as AuthApiService,
      noopSweep,
    );
    breakGlass.onModuleInit();
    controller = new VaultController(
      vault,
      config,
      breakGlass,
      audit,
      {} as AuditApiService,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function seed(): Promise<string> {
    const ownerId = randomUUID();
    await vault.create('sa@qa.test', {
      ownerType: 'device',
      ownerId,
      kind: 'password',
      label: `E2E admin web ${ownerId.slice(0, 6)}`,
      note: NOTE,
      value: 'Cisco#Core2026!',
    });
    await vault.create('sa@qa.test', {
      ownerType: 'device',
      ownerId,
      kind: 'password',
      label: `E2E SSH ${ownerId.slice(0, 6)}`,
      value: 'Khong#GhiChu2026',
    });
    return ownerId;
  }

  function as(role: string, email: string): AuthedRequest {
    return { user: { role, email, sessionId: randomUUID() } } as unknown as AuthedRequest;
  }

  async function list(ownerId: string, req: AuthedRequest) {
    const rows = await controller.list({ ownerType: 'device', ownerId }, req);
    return rows.map((row) => ({ label: row.label, note: row.note, hasNote: row.hasNote }));
  }

  it('Member cần-duyệt, chưa có quyền: thấy tên ngăn, KHÔNG thấy chữ nào của ghi chú', async () => {
    const ownerId = await seed();
    tier = 'needs_approval';
    const rows = await list(ownerId, as('member', 'e2e-note-member@qa.test'));
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain(NOTE);
    expect(rows.every((row) => row.note === null)).toBe(true);
    // Vẫn biết ngăn nào CÓ ghi chú — để biết xin quyền là thấy thêm gì.
    expect(rows.filter((row) => row.hasNote)).toHaveLength(1);
  });

  it('Member cần-duyệt đã được duyệt (chưa xem lần nào): thấy ghi chú', async () => {
    const ownerId = await seed();
    tier = 'needs_approval';
    const member = 'e2e-note-granted@qa.test';
    const created = await scratch.db.transaction((tx) =>
      approvals.createWithin(tx, {
        kind: 'break_glass',
        requester: member,
        subjectType: 'device',
        subjectId: ownerId,
        reason: 'Sự cố',
        payload: { hours: 2 },
      }),
    );
    await breakGlass.approve('duyet@qa.test', created.id, {});
    const rows = await list(ownerId, as('member', member));
    expect(rows.find((row) => row.hasNote)?.note).toBe(NOTE);
  });

  it('Member xem thẳng (whitelist): thấy ghi chú', async () => {
    const ownerId = await seed();
    tier = 'whitelist';
    const rows = await list(ownerId, as('member', 'e2e-note-white@qa.test'));
    expect(rows.find((row) => row.hasNote)?.note).toBe(NOTE);
  });

  it('Admin: thấy ghi chú, không hỏi ma trận quyền', async () => {
    const ownerId = await seed();
    tier = 'denied';
    const rows = await list(ownerId, as('admin', 'admin@qa.test'));
    expect(rows.find((row) => row.hasNote)?.note).toBe(NOTE);
  });
});
