import { Injectable, Logger } from '@nestjs/common';
import { SystemConfigService } from '../config-sys/system-config.service';
import { ApprovalsApiService } from '../approvals/approvals.api';
import { ExpiryApiService } from '../expiry/expiry.api';
import { OutboxService } from '../outbox/outbox.service';
import { UsersApiService } from '../users/users.api';
import { renderMail } from './mail-layout';
import { MailTransportService } from './mail-transport.service';

const APP_URL = () => process.env.APP_BASE_URL ?? 'https://ims.pmh.com.vn';

/**
 * Consumer outbox → email (chạy trong process worker).
 * Mỗi topic có một hàm dựng nội dung; thêm topic mới = thêm một nhánh ở đây,
 * KHÔNG rải nodemailer khắp module nghiệp vụ (AD-15).
 */
@Injectable()
export class MailConsumer {
  private readonly logger = new Logger(MailConsumer.name);

  constructor(
    private readonly outbox: OutboxService,
    private readonly users: UsersApiService,
    private readonly transport: MailTransportService,
    private readonly config: SystemConfigService,
    private readonly expiry: ExpiryApiService,
    private readonly approvals: ApprovalsApiService,
  ) {}

  async handle(topic: string, outboxId: string): Promise<void> {
    const row = await this.outbox.loadForConsumer(outboxId);
    if (!row || row.processedAt) return;

    const payload = row.payload as { userId?: string; ruleId?: string; isTest?: boolean };
    const built = await this.build(topic, payload);
    if (!built) {
      this.logger.warn(`Topic ${topic} chưa có mẫu email — bỏ qua.`);
      await this.outbox.markProcessed(outboxId);
      return;
    }

    const from = await this.config.getString('mailFromAddress');
    await this.transport.send(from, built);
    await this.outbox.markProcessed(outboxId);
  }

  /**
   * Thư báo có yêu cầu duyệt (story 6.1).
   *
   * Gửi cho SA + Admin: người duyệt được xác định theo VAI chứ không theo một danh sách email
   * cấu hình tay — đổi người thì đổi vai, không phải nhớ đi sửa một ô cấu hình nào đó.
   *
   * Thư KHÔNG chứa bất kỳ bí mật nào, kể cả tên secret: nó chỉ nói "có người xin quyền trên
   * đối tượng X, lý do Y" và đưa một đường dẫn. Ai muốn quyết thì phải đăng nhập.
   */
  private async buildApprovalMail(approvalId: string, isReminder: boolean) {
    const request = await this.approvals.findOne(approvalId).catch(() => null);
    // Yêu cầu đã bị xử lý xong trước khi thư kịp đi → thôi, đừng làm phiền người duyệt.
    if (!request || request.state !== 'pending') return null;

    const approvers = await this.users.recipientsByRole(['sa', 'admin']);
    if (approvers.length === 0) return null;

    const waited = Math.round((Date.now() - request.createdAt.getTime()) / 60_000);
    const { html, text } = renderMail({
      title: isReminder ? 'Yêu cầu duyệt còn đang chờ' : 'Có yêu cầu cần duyệt',
      intro: isReminder
        ? `Yêu cầu dưới đây đã chờ ${waited} phút mà chưa ai xử lý.`
        : `${request.requester} vừa gửi một yêu cầu cần người duyệt.`,
      rows: [
        { label: 'Người xin', value: request.requester },
        { label: 'Lý do', value: request.reason },
        { label: 'Lúc', value: request.createdAt.toLocaleString('vi-VN') },
      ],
      ctaLabel: 'Mở màn duyệt',
      ctaUrl: `${APP_URL()}/duyet-yeu-cau`,
      footnote:
        'Duyệt được trên điện thoại. Quyền cấp ra luôn có thời hạn và tự cắt khi hết giờ.',
    });

    return {
      to: approvers.map((r) => r.email),
      subject: isReminder
        ? `[IMS] Nhắc: yêu cầu của ${request.requester} chờ ${waited} phút`
        : `[IMS] Yêu cầu cần duyệt từ ${request.requester}`,
      html,
      text,
    };
  }

  private async build(
    topic: string,
    payload: { userId?: string; ruleId?: string; isTest?: boolean; approvalId?: string },
  ) {
    // Báo cáo tổng hợp không gắn với một user nào — xử riêng trước khi tra user.
    // Nội dung DỰNG LẠI từ `ruleId`: outbox chỉ giữ id tham chiếu, không PII (AD-11/NFR-04).
    if (topic === 'expiry.digest') {
      if (!payload.ruleId) return null;
      const digest = await this.expiry.buildDigest(payload.ruleId);
      return buildDigestMail(digest, payload.isTest === true);
    }

    /**
     * Thư của luồng duyệt cũng không gắn với một user cụ thể — nội dung DỰNG LẠI từ
     * `approvalId` vì outbox chỉ giữ id tham chiếu, không PII (AD-11/NFR-04).
     */
    if (topic === 'approval.requested' || topic === 'approval.reminder') {
      if (!payload.approvalId) return null;
      return this.buildApprovalMail(payload.approvalId, topic === 'approval.reminder');
    }

    const user = payload.userId ? await this.users.getById(payload.userId) : null;
    const sa = await this.users.recipientsByRole(['sa']);

    switch (topic) {
      case 'auth.account.locked': {
        if (!user) return null;
        const { html, text } = renderMail({
          title: 'Tài khoản bị khóa do đăng nhập sai nhiều lần',
          intro: `Tài khoản ${user.email} vừa bị khóa tạm thời vì nhập sai mật khẩu quá số lần cho phép.`,
          rows: [
            { label: 'Người dùng', value: `${user.fullName} (${user.email})` },
            { label: 'Thời điểm', value: new Date().toLocaleString('vi-VN') },
          ],
          ctaLabel: 'Xem nhật ký đăng nhập',
          ctaUrl: `${APP_URL()}/quan-tri/nhat-ky`,
          footnote: 'Khóa tự mở sau thời gian cấu hình. SA có thể mở sớm trong màn Tài khoản.',
        });
        return { to: sa.map((r) => r.email), subject: `[IMS] Khóa tài khoản ${user.email}`, html, text };
      }
      case 'auth.device.new': {
        if (!user) return null;
        const { html, text } = renderMail({
          title: 'Đăng nhập từ thiết bị mới',
          intro: `Tài khoản của bạn vừa đăng nhập từ một thiết bị hoặc trình duyệt chưa từng dùng.`,
          rows: [{ label: 'Thời điểm', value: new Date().toLocaleString('vi-VN') }],
          footnote: 'Nếu không phải bạn, đổi mật khẩu ngay và báo SA.',
        });
        return { to: [user.email], subject: '[IMS] Đăng nhập từ thiết bị mới', html, text };
      }
      case 'account.created': {
        if (!user) return null;
        const { html, text } = renderMail({
          title: 'Tài khoản IMS đã được tạo',
          intro: `Chào ${user.fullName}, SA vừa tạo tài khoản IMS cho bạn. Mật khẩu tạm do SA cung cấp trực tiếp.`,
          rows: [
            { label: 'Email đăng nhập', value: user.email },
            { label: 'Vai trò', value: user.role },
          ],
          ctaLabel: 'Đăng nhập',
          ctaUrl: APP_URL(),
          footnote: 'Lần đăng nhập đầu bạn sẽ phải đổi mật khẩu và cài xác thực 2 lớp.',
        });
        return { to: [user.email], subject: '[IMS] Tài khoản của bạn đã sẵn sàng', html, text };
      }
      case 'auth.password.changed':
      case 'account.password.reset': {
        if (!user) return null;
        const reset = topic === 'account.password.reset';
        const { html, text } = renderMail({
          title: reset ? 'Mật khẩu đã được SA đặt lại' : 'Mật khẩu đã được đổi',
          intro: reset
            ? 'SA vừa đặt lại mật khẩu cho tài khoản của bạn. Mọi phiên đang mở đã bị đăng xuất.'
            : 'Mật khẩu tài khoản của bạn vừa được đổi. Mọi phiên khác đã bị đăng xuất.',
          rows: [{ label: 'Thời điểm', value: new Date().toLocaleString('vi-VN') }],
          footnote: 'Nếu không phải bạn thực hiện, báo SA ngay lập tức.',
        });
        return { to: [user.email], subject: '[IMS] Thay đổi mật khẩu', html, text };
      }
      case 'account.mfa.reset': {
        if (!user) return null;
        const { html, text } = renderMail({
          title: 'Xác thực 2 lớp đã được đặt lại',
          intro: 'SA vừa đặt lại xác thực 2 lớp cho tài khoản của bạn. Lần đăng nhập tới bạn sẽ cài lại từ đầu.',
          footnote: 'Nếu không phải bạn yêu cầu, báo SA ngay lập tức.',
        });
        return { to: [user.email], subject: '[IMS] Đặt lại xác thực 2 lớp', html, text };
      }
      default:
        return null;
    }
  }
}

/** Nội dung digest do `ExpiryApiService.buildDigest` dựng — outbox không giữ thứ này. */
interface DigestContent {
  ruleName: string;
  schedule: string;
  withinDays: number;
  recipients: string[];
  total: number;
  expired: number;
  upcoming: number;
  items: {
    label: string;
    kind: string;
    start: string | null;
    end: string;
    link: string;
    daysLeft: number;
  }[];
}

const KIND_LABEL: Record<string, string> = {
  warranty: 'Bảo hành thiết bị',
  license: 'License phần mềm',
  ssl: 'Chứng chỉ SSL',
  domain: 'Tên miền',
  maintenance: 'Hợp đồng bảo trì',
  isp: 'Hợp đồng đường truyền',
};

/**
 * MỘT email tổng hợp cho cả luật (FR-013), không phải mail lẻ từng món.
 *
 * Tiêu đề tách hai con số "đã quá hạn" và "sắp hết hạn": gọi tất cả là "sắp hết hạn" trong
 * khi thân thư ghi "ĐÃ QUÁ HẠN 200 ngày" thì người đọc mất tin vào cái tiêu đề, và thứ quá
 * hạn — thứ gấp nhất — lại bị chìm.
 */
function buildDigestMail(digest: DigestContent, isTest: boolean) {
  if (digest.recipients.length === 0) return null;

  const rows = digest.items.map((item) => ({
    label: `${item.label} · ${KIND_LABEL[item.kind] ?? item.kind}`,
    value:
      item.daysLeft < 0
        ? `${item.end} — ĐÃ QUÁ HẠN ${Math.abs(item.daysLeft)} ngày`
        : `${item.end} — còn ${item.daysLeft} ngày`,
  }));

  const headline =
    digest.expired > 0
      ? `${digest.expired} mục ĐÃ QUÁ HẠN, ${digest.upcoming} mục sắp hết hạn`
      : `${digest.upcoming} mục sắp hết hạn`;

  const { html, text } = renderMail({
    title: `${isTest ? '[GỬI THỬ] ' : ''}${headline}`,
    intro:
      `Luật "${digest.ruleName}" (${digest.schedule}) — mục hết hạn trong ${digest.withinDays} ` +
      'ngày tới, kèm những mục đã quá hạn mà chưa ai xử.',
    rows,
    ctaLabel: 'Mở màn Sắp hết hạn',
    ctaUrl: `${APP_URL()}/sap-het-han`,
    footnote: isTest
      ? 'Đây là email gửi thử từ màn cấu hình luật. Kỳ gửi thật không bị ảnh hưởng.'
      : 'Email tự động từ IMS. Đổi người nhận hoặc tần suất ở màn Sắp hết hạn › Luật gửi báo cáo.',
  });

  return {
    to: digest.recipients,
    subject: `${isTest ? '[Gửi thử] ' : ''}[IMS] ${headline} — ${digest.ruleName}`,
    html,
    text,
  };
}
