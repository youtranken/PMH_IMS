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
    const host = process.env.SMTP_HOST ?? 'mailpit';
    const port = Number(process.env.SMTP_PORT ?? 1025);
    const user = process.env.SMTP_USER ?? '';
    const pass = user ? readSecretFile('SMTP_PASSWORD_FILE', false) : '';
    this.transporter = createTransport({
      host,
      port,
      secure: port === 465,
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
