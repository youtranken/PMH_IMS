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
import type { AuthApiService } from '../src/modules/auth/auth.api';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';
import { noSweep } from './sweep-stub';
import { approveByCode, breakGlassCodes } from './break-glass-codes';
import type { MailContentRegistry } from '../src/common/mail-content.registry';

/**
 * Thư của luồng mở két — qua outbox, trên Postgres thật và SMTP thật.
 *
 * Ba lời hứa của AD-5 / Q-30 mà chỉ DB thật trả lời được:
 *   1. quyết định và hàng outbox báo người xin sống chết CÙNG một transaction — quyết định bị
 *      từ chối (phiếu đã có người xử lý) thì không có thư nào rời đi;
 *   2. consumer dựng lại thư kết quả từ `approvalId` và thư tới đúng người xin;
 *   3. thư mang mã tới ĐÚNG người duyệt đã chọn, không tới ai khác.
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
  let contents: MailContentRegistry;
  let users: UsersApiService;
  let config: SystemConfigService;
  const SESSION = randomUUID();
  const as = (email: string) => ({ email, sessionId: SESSION });
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
    config = {
      getNumber: () => Promise.resolve(24),
      getString: (key: string) =>
        Promise.resolve(key === 'appTimezone' ? 'Asia/Ho_Chi_Minh' : 'IMS <no-reply@pmh.local>'),
    } as unknown as SystemConfigService;
    outbox = new OutboxService(scratch.db, config, noSweep);
    const owners = {
      describe: () =>
        Promise.resolve({ code, name: 'Switch lõi tầng 3', siteCode: 'E2E-HCM', orphan: false }),
    } as unknown as VaultOwnersService;
    const vault = { countFor: () => Promise.resolve(2) } as unknown as VaultService;
    users = {
      namesByEmails: (emails: string[]) => Promise.resolve(new Map(emails.map((e) => [e.toLowerCase(), e]))),
      roleByEmail: () => Promise.resolve('member'),
      recipientsByRole: () =>
        Promise.resolve([
          { email: 'duyet@pmh.local', fullName: 'Duyệt' },
          { email: 'dem@pmh.local', fullName: 'Đếm' },
        ]),
      getById: () => Promise.resolve(null),
    } as unknown as UsersApiService;
    const approvalsApi = new ApprovalsApiService(approvals);
    const built = breakGlassCodes({ db: scratch.db, outbox, approvals: approvalsApi, kinds, users, config });
    contents = built.contents;
    breakGlass = new BreakGlassService(
      scratch.db,
      kinds,
      approvalsApi,
      { tierFor: () => Promise.resolve('needs_approval') } as unknown as AccessListService,
      config,
      outbox,
      owners,
      vault,
      users,
      {
        isSessionAlive: () => Promise.resolve(true),
        aliveSessionIds: (ids: string[]) => Promise.resolve(new Set(ids)),
      } as unknown as AuthApiService,
      { register: () => undefined } as unknown as SweepService,
      built.codes,
    );
    breakGlass.onModuleInit();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await scratch.pool.query('TRUNCATE outbox');
  });

  function request(requester = `xin-${randomUUID().slice(0, 8)}@qa.test`, approver = 'duyet@pmh.local') {
    return breakGlass.request(as(requester), {
      ownerType: 'device',
      ownerId: randomUUID(),
      reason: 'Sự cố lúc 2 giờ sáng',
      hours: 4,
      approver,
    });
  }

  function consumer() {
    return new MailConsumer(
      outbox,
      users,
      new MailTransportService(),
      config,
      {} as ExpiryApiService,
      new ApprovalsApiService(approvals),
      kinds,
      contents,
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
    await approveByCode(breakGlass, contents, as(a.requester), a.id);
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

    // Người xin nhập mã trên phiếu đã bị từ chối: không thư, không quyền.
    await expect(breakGlass.submitCode(as(a.requester), a.id, '123456')).rejects.toMatchObject({ status: 409 });
    // Người xin chọn chính mình làm người duyệt: không có phiếu, không có thư.
    await expect(request('duyet@pmh.local', 'duyet@pmh.local')).rejects.toMatchObject({ status: 400 });

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

  it('badge: chỉ đếm phiếu chọn đúng mình (Q-30)', async () => {
    const before = await breakGlass.pendingCountFor('dem@pmh.local');
    await request(undefined, 'dem@pmh.local');
    await request();
    expect(await breakGlass.pendingCountFor('dem@pmh.local')).toBe(before + 1);
  });

  it(
    'thư mang mã đi qua SMTP thật tới ĐÚNG người duyệt đã chọn; mã trong thư mở được yêu cầu',
    async () => {
      const requester = `xin-ma-${Date.now().toString(36)}@pmh.local`;
      const a = await request(requester, 'dem@pmh.local');
      const { rows } = await scratch.pool.query<{ id: string }>(
        `SELECT id FROM outbox WHERE topic = 'break_glass.code' AND payload->>'approvalId' = $1`,
        [a.id],
      );
      await consumer().handle('break_glass.code', rows[0].id);

      const found = (await inbox()).find((m) => m.Subject.includes(requester));
      expect(found?.To.map((t) => t.Address)).toEqual(['dem@pmh.local']);
      expect(found?.Subject).not.toMatch(/\b\d{6}\b/);
      const body = (await (await fetch(`${MAILPIT_API}/message/${found!.ID}`)).json()) as { Text: string };
      const mailed = /Mã duyệt\W+(\d{6})/.exec(body.Text)?.[1];
      expect(mailed).toMatch(/^\d{6}$/);
      await breakGlass.submitCode(as(requester), a.id, mailed!);
      const { rows: state } = await scratch.pool.query<{ state: string; decided_by: string }>(
        `SELECT state, decided_by FROM approval WHERE id = $1`,
        [a.id],
      );
      expect(state[0]).toEqual({ state: 'approved', decided_by: 'dem@pmh.local' });
    },
    TEST_TIMEOUT,
  );

  it(
    'consumer gửi thư THẬT tới người xin, có mã máy và hạn; hàng outbox được đánh dấu xong',
    async () => {
      const requester = `nguoi-xin-${Date.now().toString(36)}@pmh.local`;
      const a = await request(requester);
      await approveByCode(breakGlass, contents, as(requester), a.id);
      const [row] = await decidedRows();
      await consumer().handle('approval.decided', row.id);

      const found = (await inbox()).find((m) => m.Subject.startsWith('[IMS] Đã duyệt') && m.Subject.includes(code));
      expect(found?.Subject).toBe(`[IMS] Đã duyệt: mở két ${code} (4 giờ)`);
      expect(found?.To.map((t) => t.Address)).toEqual([requester]);

      const body = (await (await fetch(`${MAILPIT_API}/message/${found!.ID}`)).json()) as {
        Text: string;
      };
      expect(body.Text).toContain(`/devices/${a.subjectId}?tab=vault`);
      expect(body.Text).toContain('duyet@pmh.local');

      const processed = await scratch.pool.query<{ processed_at: Date | null }>(
        'SELECT processed_at FROM outbox WHERE id = $1',
        [row.id],
      );
      expect(processed.rows[0].processed_at).not.toBeNull();
    },
    TEST_TIMEOUT,
  );
});
