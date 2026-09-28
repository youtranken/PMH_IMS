import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runMigrations } from '../src/database/migration-runner';
import { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import { ApprovalsService } from '../src/modules/approvals/approvals.service';
import { ApprovalsApiService } from '../src/modules/approvals/approvals.api';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import { BreakGlassService } from '../src/modules/vault/break-glass.service';
import { MailConsumer } from '../src/modules/mail/mail.consumer';
import { MailTransportService } from '../src/modules/mail/mail-transport.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { AccessListService } from '../src/modules/vault/access-list.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { VaultOwnersService } from '../src/modules/vault/vault-owners.service';
import type { VaultService } from '../src/modules/vault/vault.service';
import type { UsersApiService } from '../src/modules/users/users.api';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Người xin được báo kết quả (Q-14) — qua outbox, trên Postgres thật và SMTP thật.
 *
 * Hai lời hứa của AD-5 mà chỉ DB thật trả lời được:
 *   1. quyết định và hàng outbox báo người xin sống chết CÙNG một transaction — quyết định bị
 *      từ chối (phiếu đã có người xử lý, người xin tự duyệt) thì không có thư nào rời đi;
 *   2. consumer dựng lại thư từ `approvalId` và thư tới đúng người xin, không tới người duyệt.
 */

const TEST_TIMEOUT = 120_000;
const MAILPIT_API = 'http://127.0.0.1:8025/api/v1';

function repoEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(join(__dirname, '..', '..', '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* không có .env thì dùng biến môi trường */
  }
  return out;
}

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

async function inbox(): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT_API}/messages?limit=200`);
  if (!res.ok) {
    throw new Error(`Không đọc được hộp thư Mailpit (${res.status}) — KHÔNG được coi là "không có thư".`);
  }
  return ((await res.json()) as { messages: MailpitMessage[] }).messages;
}

describe('Break-glass: quyết định → outbox → thư cho người xin', () => {
  let scratch: ScratchDb;
  let approvals: ApprovalsService;
  let breakGlass: BreakGlassService;
  let outbox: OutboxService;
  let kinds: ApprovalKindRegistry;
  const code = `SW-E2E-BGMAIL-${Date.now().toString(36).toUpperCase()}`;

  beforeAll(async () => {
    const env = { ...repoEnv(), ...process.env };
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = env.SMTP_TEST_PORT ?? '51025';
    delete process.env.SMTP_USER;

    scratch = await createScratchDb('ims_bg_decided');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    kinds = new ApprovalKindRegistry();
    approvals = new ApprovalsService(scratch.db, audit, kinds);
    outbox = new OutboxService(scratch.db);
    const config = { getNumber: () => Promise.resolve(24) } as unknown as SystemConfigService;
    const owners = {
      describe: () =>
        Promise.resolve({ code, name: 'Switch lõi tầng 3', siteCode: 'E2E-HCM', orphan: false }),
    } as unknown as VaultOwnersService;
    const vault = { countFor: () => Promise.resolve(2) } as unknown as VaultService;
    const users = {
      namesByEmails: (emails: string[]) => Promise.resolve(new Map(emails.map((e) => [e, e]))),
      roleByEmail: () => Promise.resolve('member'),
    } as unknown as UsersApiService;
    breakGlass = new BreakGlassService(
      scratch.db,
      kinds,
      new ApprovalsApiService(approvals),
      {} as AccessListService,
      config,
      outbox,
      owners,
      vault,
      users,
    );
    breakGlass.onModuleInit();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await scratch.pool.query('TRUNCATE outbox');
  });

  function request(requester = `xin-${randomUUID().slice(0, 8)}@qa.test`) {
    return scratch.db.transaction((tx) =>
      approvals.createWithin(tx, {
        kind: 'break_glass',
        requester,
        subjectType: 'device',
        subjectId: randomUUID(),
        reason: 'Sự cố lúc 2 giờ sáng',
        payload: { hours: 4 },
      }),
    );
  }

  async function decidedRows() {
    const r = await scratch.pool.query<{ id: string; payload: Record<string, unknown> }>(
      `SELECT id, payload FROM outbox WHERE topic = 'approval.decided' ORDER BY created_at`,
    );
    return r.rows;
  }

  it('duyệt / từ chối / thu hồi sớm: mỗi quyết định đẩy đúng một hàng, mang state đã quyết', async () => {
    const a = await request();
    await breakGlass.approve('duyet@qa.test', a.id, { hours: 2 });
    await breakGlass.revoke('duyet@qa.test', a.id);
    const b = await request();
    await breakGlass.deny('duyet@qa.test', b.id, 'Lý do chưa đủ cụ thể');

    expect((await decidedRows()).map((r) => r.payload)).toEqual([
      { approvalId: a.id, state: 'approved' },
      { approvalId: a.id, state: 'revoked' },
      { approvalId: b.id, state: 'denied' },
    ]);
  });

  it('quyết định bị từ chối thì KHÔNG có thư nào rời đi (cùng transaction)', async () => {
    const a = await request();
    await breakGlass.deny('duyet@qa.test', a.id);
    await scratch.pool.query('TRUNCATE outbox');

    // Người thứ hai bấm Duyệt trên phiếu đã bị từ chối.
    await expect(breakGlass.approve('khac@qa.test', a.id)).rejects.toBeDefined();
    // Người xin tự duyệt.
    const own = await request('tu-duyet@qa.test');
    await expect(breakGlass.approve('tu-duyet@qa.test', own.id)).rejects.toBeDefined();

    expect(await decidedRows()).toEqual([]);
  });

  it('trang chi tiết: người duyệt đọc mọi phiếu, Member chỉ phiếu của mình — phiếu người khác y như không có', async () => {
    const a = await request('chu-phieu@qa.test');

    const seen = await breakGlass.detail('sa@qa.test', true, a.id);
    expect(seen).toMatchObject({
      id: a.id,
      subjectLabel: `${code} · Switch lõi tầng 3 · E2E-HCM`,
      secretCount: 2,
    });
    // Người xin đọc được phiếu của mình, nhưng không nhận số ngăn két.
    expect(await breakGlass.detail('CHU-PHIEU@qa.test', false, a.id)).toMatchObject({
      id: a.id,
      secretCount: null,
    });

    const other = breakGlass.detail('ke-khac@qa.test', false, a.id).catch((e: unknown) => e);
    const missing = breakGlass.detail('ke-khac@qa.test', false, randomUUID()).catch((e: unknown) => e);
    const [otherError, missingError] = await Promise.all([other, missing]);
    expect((otherError as { getStatus(): number }).getStatus()).toBe(404);
    expect((otherError as { getResponse(): unknown }).getResponse()).toEqual(
      (missingError as { getResponse(): unknown }).getResponse(),
    );
  });

  it('badge: không đếm phiếu của chính người duyệt (bốn mắt)', async () => {
    const before = await breakGlass.pendingCountFor('dem@qa.test');
    await request('dem@qa.test');
    await request();
    expect(await breakGlass.pendingCountFor('dem@qa.test')).toBe(before + 1);
  });

  it(
    'consumer gửi thư THẬT tới người xin, có mã máy và hạn; hàng outbox được đánh dấu xong',
    async () => {
      const requester = `nguoi-xin-${Date.now().toString(36)}@pmh.local`;
      const a = await request(requester);
      await breakGlass.approve('duyet@qa.test', a.id, { hours: 2, note: 'Chỉ đổi VLAN' });
      const [row] = await decidedRows();

      const users = {
        namesByEmails: (emails: string[]) => Promise.resolve(new Map(emails.map((e) => [e, e]))),
        recipientsByRole: () => Promise.resolve([{ email: 'duyet@pmh.local', fullName: 'Duyệt' }]),
        getById: () => Promise.resolve(null),
      } as unknown as UsersApiService;
      const config = {
        getString: (key: string) =>
          Promise.resolve(key === 'appTimezone' ? 'Asia/Ho_Chi_Minh' : 'IMS <no-reply@pmh.local>'),
      } as unknown as SystemConfigService;
      const consumer = new MailConsumer(
        outbox,
        users,
        new MailTransportService(),
        config,
        {} as ExpiryApiService,
        new ApprovalsApiService(approvals),
        kinds,
      );
      await consumer.handle('approval.decided', row.id);

      const found = (await inbox()).find((m) => m.Subject.includes(code));
      expect(found?.Subject).toBe(`[IMS] Đã duyệt: mở két ${code} (2 giờ)`);
      expect(found?.To.map((t) => t.Address)).toEqual([requester]);

      const body = (await (await fetch(`${MAILPIT_API}/message/${found!.ID}`)).json()) as {
        Text: string;
      };
      expect(body.Text).toContain(`/devices/${a.subjectId}?tab=vault`);
      expect(body.Text).toContain('Chỉ đổi VLAN');

      const processed = await scratch.pool.query<{ processed_at: Date | null }>(
        'SELECT processed_at FROM outbox WHERE id = $1',
        [row.id],
      );
      expect(processed.rows[0].processed_at).not.toBeNull();
    },
    TEST_TIMEOUT,
  );
});
