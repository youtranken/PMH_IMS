import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { readSecretFile } from '../../common/secrets';

export interface MailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

/**
 * Hạ tầng gửi mail (AD-12 copy nếp QLTS, rút gọn).
 * Dev: mailpit (không auth, cổng 1025). Prod: SMTP thật, mật khẩu đọc từ docker secret.
 * KHÔNG ai gọi thẳng service này trong request — mọi email đi qua outbox (AD-5).
 */
@Injectable()
export class MailTransportService {
  private readonly logger = new Logger(MailTransportService.name);
  private transporter: Transporter | null = null;

  private get transport(): Transporter {
    if (this.transporter) return this.transporter;
    // Không rơi về mailpit (OPS-01): thiếu SMTP_HOST ở prod là mọi thư đi vào hư không.
    const host = process.env.SMTP_HOST;
    if (!host) throw new Error('Thiếu SMTP_HOST — prod là smtp.gmail.com, dev là mailpit.');
    const port = Number(process.env.SMTP_PORT ?? 1025);
    const user = process.env.SMTP_USER ?? '';
    const pass = user ? readSecretFile('SMTP_PASSWORD_FILE', false) : '';
    this.transporter = createTransport({
      host,
      port,
      secure: port === 465,
      // 587 là STARTTLS: bắt buộc nâng cấp TLS, không để mật khẩu đi dạng rõ nếu server từ chối.
      requireTLS: port === 587,
      // Mặc định của nodemailer là 2 phút kết nối / 10 phút socket: firewall nuốt gói là hàng đợi đứng.
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 60_000,
      ...(user ? { auth: { user, pass } } : {}),
    });
    this.logger.log(`SMTP: ${host}:${port}${user ? ` (user ${user})` : ' (không auth — dev)'}`);
    return this.transporter;
  }

  async send(from: string, message: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from,
      to: message.to.join(', '),
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
