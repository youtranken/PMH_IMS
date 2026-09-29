import { NotFoundException } from '@nestjs/common';
import { ApprovalKindRegistry } from '../../common/approvals/approvals-registry';
import { MailConsumer } from './mail.consumer';
import type { OutboxService } from '../outbox/outbox.service';
import type { UsersApiService } from '../users/users.api';
import type { MailTransportService } from './mail-transport.service';
import type { SystemConfigService } from '../config-sys/system-config.service';
import type { ExpiryApiService } from '../expiry/expiry.api';
import type { ApprovalsApiService, ApprovalRecord } from '../approvals/approvals.api';

/**
 * Thư của luồng break-glass (Q-14): người duyệt quyết được ngay từ hộp thư, người xin biết kết
 * quả mà không phải ngồi F5.
 *
 * Hai luật không được phá: thư KHÔNG chứa tên hay giá trị secret, và mọi nội dung dựng lại từ
 * `approvalId` (outbox không mang PII — AD-11/NFR-04).
 */

const CREATED = new Date('2026-01-02T03:04:05Z');
const DECIDED = new Date('2026-01-02T03:10:00Z');
const REQUESTER = 'tran.b@pmh.com.vn';
const SECRET_LABEL = 'Mật khẩu enable lõi';

type Sent = { to: string[]; subject: string; text: string; html: string };

function record(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    id: 'a1',
    kind: 'break_glass',
    state: 'pending',
    requester: REQUESTER,
    subjectType: 'device',
    subjectId: 'd1',
    reason: 'Switch tầng 3 mất kết nối',
    payload: { hours: 4 },
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

function consumer(
  sent: Sent[],
  options: {
    payload: Record<string, unknown>;
    row?: ApprovalRecord | null;
    describe?: boolean;
    /** Chỉ một người duyệt được trong hệ thống: `sa@pmh.com.vn`. */
    onlySa?: boolean;
  },
) {
  const outbox = {
    loadForConsumer: () =>
      Promise.resolve({ payload: options.payload, createdAt: CREATED, processedAt: null }),
    markProcessed: () => Promise.resolve(),
  } as unknown as OutboxService;
  const users = {
    getById: () => Promise.resolve(null),
    recipientsByRole: () =>
      Promise.resolve(
        options.onlySa
          ? [{ email: 'sa@pmh.com.vn', fullName: 'SA' }]
          : [
              { email: 'sa@pmh.com.vn', fullName: 'SA' },
              { email: 'admin@pmh.com.vn', fullName: 'Admin' },
            ],
      ),
    namesByEmails: (emails: string[]) =>
      Promise.resolve(new Map(emails.map((e) => [e, e === REQUESTER ? 'Trần Thị B' : e]))),
  } as unknown as UsersApiService;
  const transport = {
    send: (_from: string, message: Sent) => {
      sent.push(message);
      return Promise.resolve();
    },
  } as unknown as MailTransportService;
  const config = {
    getString: (key: string) =>
      Promise.resolve(key === 'appTimezone' ? 'Asia/Ho_Chi_Minh' : 'ims@pmh.com.vn'),
  } as unknown as SystemConfigService;
  const row = options.row === undefined ? record() : options.row;
  const approvals = {
    findOne: () =>
      row
        ? Promise.resolve(row)
        : Promise.reject(new NotFoundException({ code: 'APPROVAL_NOT_FOUND' })),
  } as unknown as ApprovalsApiService;
  const kinds = new ApprovalKindRegistry();
  if (options.describe !== false) {
    kinds.registerDescriber('break_glass', () =>
      Promise.resolve({
        code: 'SW-CORE-01',
        label: 'SW-CORE-01 · Switch lõi tầng 3 · HCM',
        path: '/devices/d1?tab=vault',
      }),
    );
  }
  return new MailConsumer(outbox, users, transport, config, {} as ExpiryApiService, approvals, kinds);
}

async function send(options: Parameters<typeof consumer>[1], topic: string): Promise<Sent[]> {
  const sent: Sent[] = [];
  await consumer(sent, options).handle(topic, 'o1');
  return sent;
}

describe('Thư xin duyệt break-glass', () => {
  it('tiêu đề nói ai xin mở két nào, bao nhiêu giờ', async () => {
    const [mail] = await send({ payload: { approvalId: 'a1' } }, 'approval.requested');
    expect(mail.subject).toBe('[IMS] Duyệt: Trần Thị B xin mở két SW-CORE-01 (4 giờ)');
    expect(mail.to).toEqual(['sa@pmh.com.vn', 'admin@pmh.com.vn']);
  });

  it('thân thư có đối tượng đầy đủ và số giờ xin; nút "Xem và duyệt" tới trang chi tiết', async () => {
    const [mail] = await send({ payload: { approvalId: 'a1' } }, 'approval.requested');
    expect(mail.text).toContain('SW-CORE-01 · Switch lõi tầng 3 · HCM');
    expect(mail.text).toContain('4 giờ');
    expect(mail.text).toContain('Xem và duyệt');
    expect(mail.text).toContain('/approvals/a1');
    // Nút to, bấm được bằng ngón tay trên điện thoại.
    expect(mail.html).toMatch(/display:block[^"]*text-align:center/);
  });

  it('Quản trị tự xin: thư xin duyệt không gửi cho chính người xin (bốn mắt)', async () => {
    const [mail] = await send(
      { payload: { approvalId: 'a1' }, row: record({ requester: 'Admin@pmh.com.vn' }) },
      'approval.requested',
    );
    expect(mail.to).toEqual(['sa@pmh.com.vn']);
  });

  it('không còn ai khác duyệt được thì không gửi thư nào', async () => {
    const sent = await send(
      { payload: { approvalId: 'a1' }, row: record({ requester: 'sa@pmh.com.vn' }), onlySa: true },
      'approval.requested',
    );
    expect(sent).toEqual([]);
  });

  it('không bao giờ chứa tên secret', async () => {
    const [mail] = await send({ payload: { approvalId: 'a1' } }, 'approval.requested');
    expect(`${mail.subject}${mail.text}${mail.html}`).not.toContain(SECRET_LABEL);
  });

  it('hồ sơ không còn gọi tên được thì vẫn gửi, không in chữ "null"', async () => {
    const [mail] = await send(
      { payload: { approvalId: 'a1' }, describe: false },
      'approval.requested',
    );
    expect(mail.subject).toBe('[IMS] Duyệt: Trần Thị B xin mở két (4 giờ)');
    expect(mail.text).not.toMatch(/null|undefined/);
  });

  it('thư nhắc cũng nói tên máy', async () => {
    const [mail] = await send({ payload: { approvalId: 'a1' } }, 'approval.reminder');
    expect(mail.subject).toMatch(/^\[IMS\] Nhắc: Trần Thị B xin mở két SW-CORE-01 \(4 giờ\) — chờ \d+ phút$/);
  });
});

describe('Thư báo kết quả cho người xin (approval.decided)', () => {
  const approved = record({
    state: 'approved',
    decidedBy: 'sa@pmh.com.vn',
    decidedAt: DECIDED,
    expiresAt: new Date(DECIDED.getTime() + 2 * 3_600_000),
    decisionNote: 'Chỉ đổi VLAN',
    active: true,
  });

  it('được duyệt: chỉ người xin nhận, có hạn và nút mở két của hồ sơ', async () => {
    const [mail] = await send(
      { payload: { approvalId: 'a1', state: 'approved' }, row: approved },
      'approval.decided',
    );
    expect(mail.to).toEqual([REQUESTER]);
    expect(mail.subject).toBe('[IMS] Đã duyệt: mở két SW-CORE-01 (2 giờ)');
    // Hạn in theo giờ ứng dụng: 03:10Z + 2h = 12:10 giờ VN.
    expect(mail.text).toContain('12:10');
    expect(mail.text).toContain('Mở két SW-CORE-01');
    expect(mail.text).toContain('/devices/d1?tab=vault');
    expect(mail.text).toContain('Chỉ đổi VLAN');
  });

  it('được duyệt: chỉ đường "mở lại, bấm Xem, nhập mã 6 số"; quyền gắn phiên xem lần đầu (Q-15)', async () => {
    const [mail] = await send(
      { payload: { approvalId: 'a1', state: 'approved' }, row: approved },
      'approval.decided',
    );
    expect(mail.text).toMatch(/bấm "Xem"/);
    expect(mail.text).toMatch(/mã 6 số/);
    expect(mail.text).toMatch(/phiên đăng nhập.*xem lần đầu/i);
    // Câu cũ "phiên đã gửi yêu cầu" là sai với luật mới — người xin đăng nhập lại vẫn dùng được.
    expect(mail.text).not.toMatch(/phiên đăng nhập đã gửi/i);
  });

  it('hết hạn chờ duyệt: báo người xin, nói gửi lại nếu còn cần (Q-15)', async () => {
    const [mail] = await send(
      {
        payload: { approvalId: 'a1', state: 'expired' },
        row: record({ state: 'expired', decidedBy: 'system', decidedAt: DECIDED }),
      },
      'approval.decided',
    );
    expect(mail.to).toEqual([REQUESTER]);
    expect(mail.subject).toBe('[IMS] Hết hạn chờ duyệt: mở két SW-CORE-01');
    expect(mail.text).toMatch(/không ai duyệt/i);
    expect(mail.text).toMatch(/gửi yêu cầu mới/i);
    expect(mail.text).toContain('/devices/d1?tab=vault');
  });

  it('bị từ chối: có ghi chú của người duyệt, nút về trang yêu cầu', async () => {
    const [mail] = await send(
      {
        payload: { approvalId: 'a1', state: 'denied' },
        row: record({
          state: 'denied',
          decidedBy: 'sa@pmh.com.vn',
          decidedAt: DECIDED,
          decisionNote: 'Lý do chưa đủ cụ thể',
        }),
      },
      'approval.decided',
    );
    expect(mail.to).toEqual([REQUESTER]);
    expect(mail.subject).toBe('[IMS] Bị từ chối: mở két SW-CORE-01');
    expect(mail.text).toContain('Lý do chưa đủ cụ thể');
    expect(mail.text).toContain('/approvals/a1');
  });

  it('bị thu hồi sớm: báo rõ quyền đã cắt', async () => {
    const [mail] = await send(
      {
        payload: { approvalId: 'a1', state: 'revoked' },
        row: { ...approved, state: 'revoked', active: false },
      },
      'approval.decided',
    );
    expect(mail.to).toEqual([REQUESTER]);
    expect(mail.subject).toBe('[IMS] Đã thu hồi sớm: quyền mở két SW-CORE-01');
  });

  it('thư đi theo quyết định ĐÃ xảy ra, không theo state lúc gửi', async () => {
    // Duyệt rồi thu hồi ngay: hàng "approved" gửi sau khi phiếu đã thành "revoked" vẫn phải là
    // thư "đã duyệt" — thư thu hồi đi bằng hàng outbox của chính nó.
    const [mail] = await send(
      {
        payload: { approvalId: 'a1', state: 'approved' },
        row: { ...approved, state: 'revoked', active: false },
      },
      'approval.decided',
    );
    expect(mail.subject).toContain('Đã duyệt');
  });

  it('thiếu state hoặc phiếu đã xoá → không gửi gì', async () => {
    expect(await send({ payload: { approvalId: 'a1' }, row: approved }, 'approval.decided')).toEqual(
      [],
    );
    expect(
      await send({ payload: { approvalId: 'a1', state: 'approved' }, row: null }, 'approval.decided'),
    ).toEqual([]);
  });
});
