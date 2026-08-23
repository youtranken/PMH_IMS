import { Injectable, Logger } from '@nestjs/common';
import { SystemConfigService } from '../config-sys/system-config.service';
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
  ) {}

  async handle(topic: string, outboxId: string): Promise<void> {
    const row = await this.outbox.loadForConsumer(outboxId);
    if (!row || row.processedAt) return;

    const payload = row.payload as DigestPayload & { userId?: string };
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

  private async build(topic: string, payload: DigestPayload & { userId?: string }) {
    // Báo cáo tổng hợp không gắn với một user nào — xử riêng trước khi tra user.
    if (topic === 'expiry.digest') return buildDigest(payload);

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

/** Payload của topic `expiry.digest` — module expiry ghi vào outbox. */
interface DigestPayload {
  ruleName?: string;
  schedule?: string;
  withinDays?: number;
  recipients?: string[];
  isTest?: boolean;
  items?: {
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
 * Mỗi dòng nêu đủ: tên, loại, hạn, còn bao nhiêu ngày — người đọc quyết được ngay có phải
 * làm gì không mà không cần mở hệ thống. Link để bấm vào đúng hồ sơ khi cần làm thật.
 */
function buildDigest(payload: DigestPayload) {
  const items = payload.items ?? [];
  const recipients = payload.recipients ?? [];
  if (recipients.length === 0) return null;

  const rows = items.map((item) => ({
    label: `${item.label} · ${KIND_LABEL[item.kind] ?? item.kind}`,
    value:
      item.daysLeft < 0
        ? `${item.end} — ĐÃ QUÁ HẠN ${Math.abs(item.daysLeft)} ngày`
        : `${item.end} — còn ${item.daysLeft} ngày`,
  }));

  const { html, text } = renderMail({
    title: `${payload.isTest ? '[GỬI THỬ] ' : ''}Sắp hết hạn: ${items.length} mục`,
    intro:
      `Luật "${payload.ruleName ?? ''}" (${payload.schedule ?? ''}) — các mục hết hạn trong ` +
      `${payload.withinDays ?? 30} ngày tới.`,
    rows,
    ctaLabel: 'Mở màn Sắp hết hạn',
    ctaUrl: `${APP_URL()}/sap-het-han`,
    footnote: payload.isTest
      ? 'Đây là email gửi thử từ màn cấu hình luật. Kỳ gửi thật không bị ảnh hưởng.'
      : 'Email tự động từ IMS. Đổi người nhận hoặc tần suất ở màn Sắp hết hạn › Luật gửi báo cáo.',
  });

  return {
    to: recipients,
    subject: `${payload.isTest ? '[Gửi thử] ' : ''}[IMS] ${items.length} mục sắp hết hạn — ${payload.ruleName ?? ''}`,
    html,
    text,
  };
}
