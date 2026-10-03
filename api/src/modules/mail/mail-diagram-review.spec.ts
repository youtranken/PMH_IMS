import { ApprovalKindRegistry } from '../../common/approvals/approvals-registry';
import { MailConsumer } from './mail.consumer';
import type { OutboxService } from '../outbox/outbox.service';
import type { UsersApiService } from '../users/users.api';
import type { MailTransportService } from './mail-transport.service';
import type { SystemConfigService } from '../config-sys/system-config.service';
import type { ExpiryApiService } from '../expiry/expiry.api';
import type { ApprovalsApiService, ApprovalRecord } from '../approvals/approvals.api';

/**
 * Thư của luồng duyệt bản vẽ (Q-23): cùng ba topic với break-glass (`approval.requested`,
 * `approval.reminder`, `approval.decided`) nhưng nói về BẢN VẼ — không một chữ "mở két" nào, nút
 * dẫn thẳng tới bản vẽ (trang duyệt nằm trên bản vẽ).
 */

const CREATED = new Date('2026-10-03T03:04:05Z');
const REQUESTER = 'tran.b@pmh.com.vn';

type Sent = { to: string[]; subject: string; text: string; html: string };

function record(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    id: 'a1',
    kind: 'diagram_publish',
    state: 'pending',
    requester: REQUESTER,
    subjectType: 'diagram',
    subjectId: 'dg1',
    reason: 'Vẽ xong tầng 3',
    payload: { versionId: 'v4', seq: 4, warnings: 2 },
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    expiresAt: null,
    claimedAt: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    active: false,
    ...overrides,
  };
}

async function send(topic: string, payload: Record<string, unknown>, row: ApprovalRecord = record()): Promise<Sent[]> {
  const sent: Sent[] = [];
  const outbox = {
    loadForConsumer: () => Promise.resolve({ payload, createdAt: CREATED, processedAt: null }),
    markProcessed: () => Promise.resolve(),
  } as unknown as OutboxService;
  const users = {
    getById: () => Promise.resolve(null),
    recipientsByRole: () =>
      Promise.resolve([
        { email: 'sa@pmh.com.vn', fullName: 'SA' },
        { email: REQUESTER, fullName: 'Trần Thị B' },
      ]),
    namesByEmails: (emails: string[]) => Promise.resolve(new Map(emails.map((e) => [e, e === REQUESTER ? 'Trần Thị B' : e]))),
  } as unknown as UsersApiService;
  const transport = {
    send: (_from: string, message: Sent) => {
      sent.push(message);
      return Promise.resolve();
    },
  } as unknown as MailTransportService;
  const config = {
    getString: (key: string) => Promise.resolve(key === 'appTimezone' ? 'Asia/Ho_Chi_Minh' : 'ims@pmh.com.vn'),
  } as unknown as SystemConfigService;
  const approvals = { findOne: () => Promise.resolve(row) } as unknown as ApprovalsApiService;
  const kinds = new ApprovalKindRegistry();
  kinds.registerDescriber('diagram_publish', () =>
    Promise.resolve({ code: 'Tầng 3', label: 'Bản vẽ Tầng 3', path: '/diagrams/dg1', detailPath: '/diagrams/dg1' }),
  );
  await new MailConsumer(outbox, users, transport, config, {} as ExpiryApiService, approvals, kinds).handle(topic, 'o1');
  return sent;
}

describe('Thư duyệt bản vẽ', () => {
  it('gửi duyệt: tới Admin/SA trừ người gửi, tiêu đề nói ai gửi bản vẽ nào, nút tới bản vẽ', async () => {
    const [mail] = await send('approval.requested', { approvalId: 'a1' });
    expect(mail.to).toEqual(['sa@pmh.com.vn']);
    expect(mail.subject).toBe('[IMS] Duyệt bản vẽ: Trần Thị B gửi "Tầng 3" (phiên bản #4)');
    expect(mail.text).toContain('Vẽ xong tầng 3');
    expect(mail.text).toContain('/diagrams/dg1');
    expect(mail.text).not.toMatch(/két/i);
  });

  it('nhắc: cùng người nhận, tiêu đề "Nhắc"', async () => {
    const [mail] = await send('approval.reminder', { approvalId: 'a1' });
    expect(mail.subject).toMatch(/^\[IMS\] Nhắc: duyệt bản vẽ "Tầng 3"/);
  });

  it('duyệt xong: báo người gửi bản đã thành chính thức', async () => {
    const [mail] = await send('approval.decided', { approvalId: 'a1', state: 'approved' }, record({ state: 'approved', decidedBy: 'sa@pmh.com.vn' }));
    expect(mail.to).toEqual([REQUESTER]);
    expect(mail.subject).toBe('[IMS] Đã duyệt: bản vẽ "Tầng 3" thành bản chính thức');
    expect(mail.text).not.toMatch(/két/i);
  });

  it('trả về: báo người gửi kèm ghi chú chung, nút tới bản vẽ để xem ghim', async () => {
    const [mail] = await send(
      'approval.decided',
      { approvalId: 'a1', state: 'returned' },
      record({ state: 'returned', decidedBy: 'sa@pmh.com.vn', decisionNote: 'Thiếu dây uplink' }),
    );
    expect(mail.to).toEqual([REQUESTER]);
    expect(mail.subject).toBe('[IMS] Trả về: bản vẽ "Tầng 3" cần sửa');
    expect(mail.text).toContain('Thiếu dây uplink');
    expect(mail.text).toContain('/diagrams/dg1');
  });
});
