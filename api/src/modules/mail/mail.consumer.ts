import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SystemConfigService } from '../config-sys/system-config.service';
import { ApprovalsApiService } from '../approvals/approvals.api';
import { ExpiryApiService } from '../expiry/expiry.api';
import { OutboxService } from '../outbox/outbox.service';
import { UsersApiService } from '../users/users.api';
import { renderMail } from './mail-layout';
import { MailTransportService } from './mail-transport.service';
import { UI_PATHS } from '../../common/ui-paths';

const APP_URL = () => process.env.APP_BASE_URL ?? 'https://ims.pmh.com.vn';

/**
 * Consumer outbox → email (chạy trong process worker).
 * Mỗi topic có một hàm dựng nội dung; thêm topic mới = thêm một nhánh ở đây,
 * KHÔNG rải nodemailer khắp module nghiệp vụ (AD-15).
 */
/**
 * TOPIC NÀO CÓ MẪU THƯ — danh sách tường minh (B-06, 22/09).
 *
 * `build()` trả `null` cho HAI chuyện khác hẳn nhau:
 *
 *   1. **Không có mẫu thư cho topic này** — ai đó đẩy một topic mà consumer chưa từng biết.
 *      Đây là LỖI: một sự kiện nghiệp vụ vừa xảy ra và không ai được báo, vĩnh viễn.
 *   2. **Có mẫu, nhưng không còn gì để gửi** — hồ sơ tham chiếu đã xoá, phiếu đã được quyết,
 *      không còn người nhận nào. Đây là chuyện BÌNH THƯỜNG, xảy ra hằng ngày.
 *
 * Bản trước ghi CÙNG MỘT dòng `warn` cho cả hai. Hậu quả: một lỗi thật nằm lẫn giữa hàng trăm
 * dòng vô hại, nên không ai lọc ra được — và ai đọc log thì quen mắt tới mức thôi đọc.
 *
 * Danh sách này gõ tay và phải khớp các `case` bên dưới. Đổi bên nào cũng phải đổi bên kia —
 * `mail-topics.spec.ts` đối chiếu hai nơi, nên lệch là đỏ.
 */
export const HANDLED_MAIL_TOPICS: ReadonlySet<string> = new Set([
  'expiry.digest',
  'approval.requested',
  'approval.reminder',
  'auth.account.locked',
  'security.probe.alert',
  'auth.device.new',
  'account.created',
  'auth.password.changed',
  'account.password.reset',
  'account.mfa.reset',
]);

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
    /*
     * Giờ in trong thư là giờ SỰ KIỆN — lúc hàng outbox được ghi, cùng transaction với việc
     * nghiệp vụ — chứ không phải lúc worker gửi: hàng đợi dồn thì thư đi trễ hàng giờ. Và
     * luôn theo `appTimezone` (AD-11): không ghim thì in theo giờ container, tức UTC.
     */
    const timeZone = await this.config.getString('appTimezone');
    const at = (date: Date) => date.toLocaleString('vi-VN', { timeZone });
    const built = await this.build(topic, payload, { eventAt: at(row.createdAt), at });
    if (!built) {
      /*
       * HAI NGUYÊN NHÂN, HAI MỨC LOG (B-06, vá 22/09).
       *
       * Bản trước gộp làm một dòng `warn`. Nhưng "không có mẫu thư cho topic này" là một LỖI
       * — một sự kiện nghiệp vụ vừa xảy ra và sẽ không ai được báo — còn "hồ sơ tham chiếu đã
       * xoá" là chuyện bình thường, xảy ra hằng ngày. Gộp lại thì lỗi thật nằm lẫn giữa hàng
       * trăm dòng vô hại, và người đọc log quen mắt tới mức thôi đọc.
       *
       * Cả hai vẫn `markProcessed`: dù vì lý do nào thì lượt này cũng không gửi được, và để
       * job quay lại mãi mãi chỉ làm hàng đợi kẹt thêm.
       */
      if (!HANDLED_MAIL_TOPICS.has(topic)) {
        this.logger.error(
          `Topic "${topic}" KHÔNG có mẫu thư nào xử lý — sự kiện này sẽ không ai được báo. ` +
            'Thêm một `case` vào `build()` và khai vào `HANDLED_MAIL_TOPICS`.',
        );
      } else {
        this.logger.debug(
          `Topic ${topic}: không còn gì để gửi (hồ sơ tham chiếu đã xoá, phiếu đã quyết, ` +
            'hoặc không còn người nhận) — bỏ qua, đây là chuyện bình thường.',
        );
      }
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
  private async buildApprovalMail(
    approvalId: string,
    isReminder: boolean,
    at: (date: Date) => string,
  ) {
    /*
     * Yêu cầu đã bị xử lý xong / xóa trước khi thư kịp đi → thôi, đừng làm phiền người duyệt.
     *
     * Bắt ĐÍCH DANH `NotFoundException`. Bản trước là `.catch(() => null)` bao trọn: một lượt
     * DB chớp cũng thành "không tìm thấy yêu cầu", `handle()` đánh dấu processed, và thư báo
     * duyệt đó mất vĩnh viễn — không ai biết vì đó đúng là đường xử lý bình thường.
     */
    const request = await this.approvals.findOne(approvalId).catch((error: unknown) => {
      if (error instanceof NotFoundException) return null;
      throw error;
    });
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
        { label: 'Lúc', value: at(request.createdAt) },
      ],
      ctaLabel: 'Mở yêu cầu này',
      ctaUrl: `${APP_URL()}${UI_PATHS.approval(request.id)}`,
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
    payload: {
      userId?: string;
      ruleId?: string;
      isTest?: boolean;
      approvalId?: string;
      who?: string;
      count?: number;
      windowMinutes?: number;
      /* Thời gian nghỉ THẬT của cảnh báo dò két, đọc từ `system_config` lúc đẩy outbox. Tùy
         chọn vì hàng outbox ghi trước 18/09/2026 không có trường này. */
      cooldownMinutes?: number;
    },
    time: { eventAt: string; at: (date: Date) => string },
  ) {
    // Báo cáo tổng hợp không gắn với một user nào — xử riêng trước khi tra user.
    // Nội dung DỰNG LẠI từ `ruleId`: outbox chỉ giữ id tham chiếu, không PII (AD-11/NFR-04).
    if (topic === 'expiry.digest') {
      if (!payload.ruleId) return null;
      /*
       * LUẬT BỊ XÓA GIỮA LÚC THƯ CÒN TRONG HÀNG ĐỢI → BỎ KỲ, KHÔNG THỬ LẠI VÔ HẠN.
       *
       * `buildDigest` ném `NotFoundException` khi luật không còn. Bản trước để nó bay thẳng ra
       * `handle()`, nên job BullMQ hỏng, hết lượt thử lại thì outbox row không bao giờ được
       * đánh dấu `processed_at` — relay lại tái phát nó sau mỗi lần hết hạn lease, mãi mãi.
       * Trên màn Hàng đợi, huy hiệu "gửi lỗi" sáng vĩnh viễn cho một luật KHÔNG CÒN TỒN TẠI,
       * và không có nút nào tắt được nó. Admin xóa một luật gõ nhầm là đủ để tạo ra chuyện đó.
       *
       * `buildApprovalMail` đã xử đúng cửa tương đương này từ trước (yêu cầu đã xử lý xong thì
       * thôi đừng gửi) — đây là cửa bị bỏ sót, mẫu N1.
       *
       * CHỈ nuốt `NotFoundException`, không nuốt tất cả: `.catch(() => null)` bao trọn sẽ biến
       * một lượt DB chớp thành "đã xử lý xong", và kỳ báo cáo đó mất vĩnh viễn — chính là lỗi
       * mà `runOne` đã phải gói lại vào một transaction để tránh.
       */
      const digest = await this.expiry.buildDigest(payload.ruleId).catch((error: unknown) => {
        if (error instanceof NotFoundException) return null;
        throw error;
      });
      if (!digest) return null;
      return buildDigestMail(digest, payload.isTest === true);
    }

    /**
     * Thư của luồng duyệt cũng không gắn với một user cụ thể — nội dung DỰNG LẠI từ
     * `approvalId` vì outbox chỉ giữ id tham chiếu, không PII (AD-11/NFR-04).
     */
    if (topic === 'approval.requested' || topic === 'approval.reminder') {
      if (!payload.approvalId) return null;
      return this.buildApprovalMail(payload.approvalId, topic === 'approval.reminder', time.at);
    }

    const user = payload.userId ? await this.users.getById(payload.userId) : null;
    const sa = await this.users.recipientsByRole(['sa']);

    switch (topic) {
      /*
       * Tài khoản vừa lên một bậc chờ (SEC-03, Q-06). Thư phải nói đúng việc hệ thống ĐÃ làm
       * (chặn tạm ở mọi nơi) để người đọc biết việc còn lại của họ là gì.
       */
      case 'auth.account.locked': {
        if (!user) return null;
        const { html, text } = renderMail({
          title: 'Một tài khoản đang bị đoán mật khẩu',
          intro:
            `Tài khoản ${user.email} vừa nhập sai mật khẩu hoặc mã xác thực ${user.failedAttempts} lần. ` +
            'Đăng nhập vào tài khoản này đang bị TẠM CHẶN ở mọi nơi; mỗi lần sai tiếp, thời gian chờ dài thêm.',
          rows: [
            { label: 'Người dùng', value: `${user.fullName} (${user.email})` },
            { label: 'Chặn đến', value: user.lockedUntil ? time.at(user.lockedUntil) : '—' },
            { label: 'Thời điểm', value: time.eventAt },
          ],
          /* Chủ tài khoản cũng nhận thư này nhưng màn Nhật ký chỉ mở cho SA/Quản trị — nhãn
             nói trước điều đó để người nhận không tưởng nút hỏng khi bấm ra trang 404. */
          ctaLabel: 'Xem nhật ký của tài khoản (SA/Quản trị)',
          ctaUrl: `${APP_URL()}${UI_PATHS.auditLog(user.email)}`,
          footnote:
            'Không phải bạn đang quên mật khẩu? Báo SA ngay. SA có thể KHÓA TAY tài khoản ở màn Tài khoản — khóa tay chặn mọi nơi và chỉ SA mở được.',
        });
        // Chủ tài khoản cũng nhận: họ là người đầu tiên biết lượt sai đó có phải của mình không.
        const to = [...new Set([user.email, ...sa.map((r) => r.email)])];
        return {
          to,
          subject: `[IMS] Đoán mật khẩu tài khoản ${user.email}`,
          html,
          text,
        };
      }
      /*
       * CÓ NGƯỜI ĐANG DÒ DẪM QUANH KÉT (0046) — em ruột của lá thư ngay trên.
       *
       * Khác một điểm quyết định: lá trên nói về cửa ĐĂNG NHẬP nên gắn được `userId`; lá này
       * nói về cửa KÉT, nơi người dò đã đăng nhập hợp lệ rồi — payload vì thế chỉ mang EMAIL,
       * số lượt và cửa sổ thời gian, không có `userId` để tra.
       *
       * Và thư tuyệt đối KHÔNG nói ngăn nào bị thử: nhãn ngăn chính là thứ người kia không
       * được phép biết, còn một lá thư là thứ dễ chuyển tiếp nhất trong cả hệ thống. Vế này có
       * bài kiểm canh (`vault.spec.ts`), không trông vào lời hứa ở đây.
       */
      case 'security.probe.alert': {
        if (!payload.who) return null;
        const admins = await this.users.recipientsByRole(['sa', 'admin']);
        if (admins.length === 0) return null;
        const { html, text } = renderMail({
          title: 'Có người đang dò dẫm quanh két sắt',
          intro:
            `${payload.who} vừa có ${payload.count ?? 0} lượt thất bại quanh két trong ` +
            `${payload.windowMinutes ?? 0} phút — bị từ chối quyền mở ngăn, hoặc gõ sai mã 6 số. ` +
            'Hàng rào đã chặn từng lượt; thư này chỉ để có người NHÌN vào.',
          rows: [
            { label: 'Tài khoản', value: payload.who },
            { label: 'Số lượt', value: String(payload.count ?? 0) },
            { label: 'Trong', value: `${payload.windowMinutes ?? 0} phút` },
            { label: 'Thời điểm', value: time.eventAt },
          ],
          ctaLabel: 'Xem nhật ký của tài khoản này',
          ctaUrl: `${APP_URL()}${UI_PATHS.auditLog(payload.who)}`,

          /* Thời gian nghỉ NỘI SUY từ payload, không viết cứng "một giờ": nó là
             `secret.probe_cooldown_minutes` trong `system_config` (AD-11) và đổi được bất cứ
             lúc nào. Viết cứng thì đổi tham số là lá thư nói dối về chính cơ chế của nó, mà
             không cổng nào đỏ lên. Còn `?? 60` chỉ là lưới đỡ cho hàng outbox cũ ghi trước
             18/09 — chúng không có trường này. */
          footnote:
            'Phần lớn trường hợp là người dùng thật gõ nhầm mã hoặc bấm vào một hồ sơ chưa được gán quyền. Hỏi thẳng người này trước khi kết luận; nhật ký cho thấy các lượt đó diễn ra lúc nào và từ đâu. ' +
            /*
             * KHÔNG ĐOÁN HỘ MỘT CON SỐ MÌNH KHÔNG BIẾT (19/09/2026).
             *
             * Lưới đỡ `?? 60` có hai chỗ hỏng, cả hai lộ ra trong lượt rà soát cùng ngày:
             *   · `??` chỉ chặn `null`/`undefined`, nên `cooldownMinutes = 0` lọt qua và thư ghi
             *     "im trong 0 phút";
             *   · 60 TRÙNG ĐÚNG giá trị seed của `secret.probe_cooldown_minutes`, nên không bài
             *     kiểm nào phân biệt được hai nguồn — bỏ hẳn trường khỏi payload thì chuỗi vẫn y
             *     nguyên, đúng mẫu `expect(x ?? DEFAULT).toBe(DEFAULT)`. Admin đặt 30 phút mà
             *     hàng outbox cũ vẫn nói "60 phút": lá thư nói dối về chính cơ chế của nó, và
             *     không cổng nào đỏ — đúng cái tật chú thích ngay trên đây tuyên bố đã dẹp.
             *
             * Hàng cũ (ghi trước 18/09) không có trường này. Với chúng, BỎ HẲN mệnh đề thay vì
             * đoán: câu ngắn hơn mà đúng, hơn là câu đầy đủ mà sai.
             */
            (typeof payload.cooldownMinutes === 'number' && payload.cooldownMinutes > 0
              ? `Thư này im trong ${payload.cooldownMinutes} phút sau mỗi lần gửi, nên không phản ánh tổng số lượt.`
              : 'Thư này có thời gian nghỉ sau mỗi lần gửi, nên không phản ánh tổng số lượt.'),
        });
        return {
          to: admins.map((r) => r.email),
          subject: `[IMS] ${payload.count ?? 0} lượt thất bại quanh két — ${payload.who}`,
          html,
          text,
        };
      }
      case 'auth.device.new': {
        if (!user) return null;
        const { html, text } = renderMail({
          title: 'Đăng nhập từ thiết bị mới',
          intro: `Tài khoản của bạn vừa đăng nhập từ một thiết bị hoặc trình duyệt chưa từng dùng.`,
          rows: [{ label: 'Thời điểm', value: time.eventAt }],
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
          rows: [{ label: 'Thời điểm', value: time.eventAt }],
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
    ctaUrl: `${APP_URL()}${UI_PATHS.expiry}`,
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
