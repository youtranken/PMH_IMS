import { ApprovalKindRegistry } from '../../common/approvals/approvals-registry';
import { MailConsumer } from './mail.consumer';
import type { OutboxService } from '../outbox/outbox.service';
import type { UsersApiService } from '../users/users.api';
import type { MailTransportService } from './mail-transport.service';
import type { SystemConfigService } from '../config-sys/system-config.service';
import type { ExpiryApiService } from '../expiry/expiry.api';
import type { ApprovalsApiService } from '../approvals/approvals.api';

/**
 * OLD-BE-01 — thư in giờ SỰ KIỆN theo múi giờ ứng dụng, không in giờ worker gửi thư.
 *
 * Hàng đợi dồn (Redis chết, SMTP chậm, worker khởi động lại) là lúc thư đi trễ hàng giờ; in
 * giờ gửi thì "đăng nhập từ thiết bị mới lúc 9:00" thật ra là lúc 2:00 sáng. Và
 * `toLocaleString` không ghim múi giờ thì in theo giờ của container — UTC trên máy chủ.
 */

/**
 * Mốc sự kiện cố ý cách xa "bây giờ" để giờ gửi không thể trùng. Múi giờ ứng dụng cố ý KHÁC
 * múi giờ Jest ghim (`jest.config.js`): trùng nhau thì một `toLocaleString` không ghim múi giờ
 * vẫn in ra đúng chuỗi và bài này xanh oan.
 */
const EVENT_AT = new Date('2026-01-02T03:04:05Z');
const APP_TZ = 'Asia/Tokyo';
const EXPECTED = '12:04:05 2/1/2026';

function consumer(sent: { text: string }[], extra: Record<string, unknown> = {}) {
  const outbox = {
    loadForConsumer: () =>
      Promise.resolve({
        payload: {
          userId: 'u1',
          approvalId: 'a1',
          who: 'nghi.van@pmh.com.vn',
          count: 5,
          windowMinutes: 10,
          ...extra,
        },
        createdAt: EVENT_AT,
        processedAt: null,
      }),
    markProcessed: () => Promise.resolve(),
  } as unknown as OutboxService;
  const users = {
    getById: () =>
      Promise.resolve({
        id: 'u1',
        email: 'nguoi.dung@pmh.com.vn',
        fullName: 'Người Dùng',
        role: 'member',
        failedAttempts: 5,
        lockedUntil: new Date('2026-01-02T03:09:05Z'),
      }),
    recipientsByRole: () => Promise.resolve([{ email: 'sa@pmh.com.vn', fullName: 'SA' }]),
    namesByEmails: () => Promise.resolve(new Map<string, string>()),
  } as unknown as UsersApiService;
  const transport = {
    send: (_from: string, message: { text: string }) => {
      sent.push(message);
      return Promise.resolve();
    },
  } as unknown as MailTransportService;
  const config = {
    getString: (key: string) =>
      Promise.resolve(key === 'appTimezone' ? APP_TZ : 'ims@pmh.com.vn'),
  } as unknown as SystemConfigService;
  const approvals = {
    findOne: () =>
      Promise.resolve({
        id: 'a1',
        state: 'pending',
        requester: 'member@pmh.com.vn',
        reason: 'Sửa sự cố',
        createdAt: EVENT_AT,
      }),
  } as unknown as ApprovalsApiService;
  return new MailConsumer(
    outbox,
    users,
    transport,
    config,
    {} as ExpiryApiService,
    approvals,
    new ApprovalKindRegistry(),
  );
}

describe('Giờ in trong thư là giờ sự kiện, theo múi giờ ứng dụng', () => {
  it.each([
    'auth.device.new',
    'auth.password.changed',
    'account.password.reset',
    'security.probe.alert',
    'auth.account.locked',
    'approval.requested',
  ])('%s', async (topic) => {
    const sent: { text: string }[] = [];
    await consumer(sent).handle(topic, 'o1');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(EXPECTED);
  });
});

/** Nút trong thư duyệt dẫn thẳng tới trang chi tiết của yêu cầu đó, không phải cả màn duyệt. */
describe('Thư duyệt break-glass', () => {
  it.each(['approval.requested', 'approval.reminder'])('%s trỏ tới /approvals/<yêu cầu>', async (topic) => {
    const sent: { text: string; html?: string }[] = [];
    await consumer(sent).handle(topic, 'o1');
    expect(sent[0].text).toContain('/approvals/a1');
  });
});

/**
 * OLD-SEC-01: lá leo thang phải nói rõ là LÁ THỨ HAI trong thời gian nghỉ — cùng tiêu đề với lá
 * đầu thì người đọc lướt qua như thư trùng, đúng lúc kẻ dò đã bắn gấp mấy lần ngưỡng.
 */
describe('Thư cảnh báo dò két leo thang', () => {
  it('payload escalated đổi tiêu đề và câu mở đầu', async () => {
    const sent: { text: string; subject?: string }[] = [];
    await consumer(sent, { escalated: true, count: 27, cooldownMinutes: 60 }).handle(
      'security.probe.alert',
      'o1',
    );
    expect(sent[0].subject).toBe('[IMS] Vẫn tiếp tục: 27 lượt thất bại quanh két — nghi.van@pmh.com.vn');
    expect(sent[0].text).toContain('vẫn tiếp tục thất bại quanh két sau lá cảnh báo trước');
    expect(sent[0].text).toContain('Đây là lá leo thang duy nhất trong 60 phút nghỉ');
  });

  it('lá thường giữ nguyên tiêu đề cũ', async () => {
    const sent: { text: string; subject?: string }[] = [];
    await consumer(sent).handle('security.probe.alert', 'o1');
    expect(sent[0].subject).toBe('[IMS] 5 lượt thất bại quanh két — nghi.van@pmh.com.vn');
    expect(sent[0].text).not.toContain('leo thang');
  });
});
