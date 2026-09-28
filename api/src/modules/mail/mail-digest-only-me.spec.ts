import { ApprovalKindRegistry } from '../../common/approvals/approvals-registry';
import { MailConsumer } from './mail.consumer';
import type { OutboxService } from '../outbox/outbox.service';
import type { UsersApiService } from '../users/users.api';
import type { MailTransportService } from './mail-transport.service';
import type { SystemConfigService } from '../config-sys/system-config.service';
import type { ExpiryApiService } from '../expiry/expiry.api';
import type { ApprovalsApiService } from '../approvals/approvals.api';

/**
 * EX-021 — "Gửi thử chỉ cho tôi": thư đi tới đúng người bấm, KHÔNG tới danh sách của luật
 * (thường là sếp và cả phòng). Outbox chỉ giữ `toUserId`, email tra lúc gửi (AD-11/NFR-04).
 */
function consumer(payload: Record<string, unknown>, user: { email: string } | null) {
  const sent: { to: string[]; subject: string }[] = [];
  const outbox = {
    loadForConsumer: () =>
      Promise.resolve({ payload, createdAt: new Date(), processedAt: null }),
    markProcessed: () => Promise.resolve(),
  } as unknown as OutboxService;
  const users = {
    getById: (id: string) => Promise.resolve(user && id === 'u-me' ? { id, ...user } : null),
    recipientsByRole: () => Promise.resolve([]),
    namesByEmails: () => Promise.resolve(new Map<string, string>()),
  } as unknown as UsersApiService;
  const transport = {
    send: (_from: string, message: { to: string[]; subject: string }) => {
      sent.push(message);
      return Promise.resolve();
    },
  } as unknown as MailTransportService;
  const config = {
    getString: (key: string) =>
      Promise.resolve(key === 'appTimezone' ? 'Asia/Ho_Chi_Minh' : 'ims@pmh.com.vn'),
  } as unknown as SystemConfigService;
  const expiry = {
    buildDigest: () =>
      Promise.resolve({
        ruleName: 'Báo SSL',
        schedule: 'Hằng ngày lúc 08:00',
        withinDays: 30,
        recipients: ['sep@pmh.com.vn', 'ca-phong@pmh.com.vn'],
        total: 1,
        expired: 0,
        upcoming: 1,
        items: [{ label: 'SSL-E2E', kind: 'ssl', start: null, end: '2026-10-01', link: '/x', daysLeft: 3 }],
      }),
  } as unknown as ExpiryApiService;
  const mail = new MailConsumer(
    outbox,
    users,
    transport,
    config,
    expiry,
    {} as ApprovalsApiService,
    new ApprovalKindRegistry(),
  );
  return { mail, sent };
}

describe('Thư báo cáo — gửi thử chỉ cho tôi', () => {
  it('có toUserId → chỉ gửi tới email của người đó', async () => {
    const { mail, sent } = consumer(
      { ruleId: 'r1', isTest: true, toUserId: 'u-me' },
      { email: 'toi@pmh.com.vn' },
    );
    await mail.handle('expiry.digest', 'o1');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['toi@pmh.com.vn']);
    expect(sent[0].subject).toMatch(/Gửi thử/);
  });

  it('không có toUserId → danh sách của luật như cũ', async () => {
    const { mail, sent } = consumer({ ruleId: 'r1', isTest: true }, null);
    await mail.handle('expiry.digest', 'o1');
    expect(sent[0].to).toEqual(['sep@pmh.com.vn', 'ca-phong@pmh.com.vn']);
  });

  it('người bấm không còn tồn tại → không gửi ai, KHÔNG rơi về danh sách của luật', async () => {
    const { mail, sent } = consumer({ ruleId: 'r1', isTest: true, toUserId: 'u-me' }, null);
    await mail.handle('expiry.digest', 'o1');
    expect(sent).toHaveLength(0);
  });
});
