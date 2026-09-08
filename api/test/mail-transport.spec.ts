import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MailTransportService } from '../src/modules/mail/mail-transport.service';

/**
 * `MailTransportService` — nơi DUY NHẤT trong repo được chạm `nodemailer` (AD-5/AD-15) — cho
 * tới 08/09 không có bài kiểm nào chạm hộp thư thật.
 *
 * Đây không phải chuyện phủ dòng code. Cả nhánh dựng transporter là những quyết định IM LẶNG
 * khi sai: `secure: port === 465`, `auth` chỉ gắn khi có `SMTP_USER`, mật khẩu đọc từ docker
 * secret chứ không từ env. Sai một trong số đó thì `sendMail` ném hoặc treo — và ở production
 * hậu quả là email nhắc hạn, đặt lại mật khẩu, cảnh báo két sắt lặng lẽ không tới ai. Không
 * màn hình nào của IMS hiện ra điều đó; outbox chỉ ghi `fail_count` tăng dần.
 *
 * Bài này gửi thư THẬT qua SMTP vào Mailpit rồi đọc lại bằng API hộp thư của nó.
 */

const TEST_TIMEOUT = 60_000;

function repoEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(join(__dirname, '..', '..', '.env'), 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...repoEnv(), ...process.env };
/**
 * Playwright và jest đều chạy NGOÀI docker, nên hostname `mailpit` không phân giải được — đó
 * là finding đã ghi trong `CLAUDE.md`. Dùng cổng loopback mở ở `docker-compose.override.e2e.yml`.
 */
const MAILPIT_API = 'http://127.0.0.1:8025/api/v1';

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

async function inbox(): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT_API}/messages?limit=200`);
  if (!res.ok) {
    throw new Error(
      `Không đọc được hộp thư Mailpit (${res.status}). Đã chạy ` +
        `\`docker compose ... --profile dev up -d mailpit\` chưa? KHÔNG được coi là "không có thư".`,
    );
  }
  return ((await res.json()) as { messages: MailpitMessage[] }).messages;
}

describe('MailTransportService gửi thư thật vào Mailpit', () => {
  const service = new MailTransportService();

  beforeAll(() => {
    // Trỏ transporter vào cổng SMTP loopback của Mailpit thay vì `mailpit:1025` trong mạng docker.
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = env.SMTP_TEST_PORT ?? '51025';
    delete process.env.SMTP_USER;
  });

  it(
    'thư tới hộp đích với đúng người nhận, tiêu đề và cả hai thân bài',
    async () => {
      const marker = `E2E-SMTP-${Date.now().toString(36)}`;
      const to = `nguoi-nhan-${marker.toLowerCase()}@pmh.local`;

      /*
       * Hai thân bài mang DẤU KHÁC NHAU, có chủ ý.
       *
       * Bản đầu của bài này dùng cùng một chuỗi cho cả `text` lẫn `html`, và khi tôi thử bỏ
       * hẳn `text: message.text` khỏi `sendMail` thì bài vẫn XANH — Mailpit tự suy phần
       * văn bản ra từ HTML. Một assertion không phân biệt được "ta gửi text" với "máy chủ tự
       * bịa text" thì không canh gì cả.
       */
      await service.send('IMS <no-reply@pmh.local>', {
        to: [to],
        subject: `IMS thu gui ${marker}`,
        html: `<p>PHAN-HTML-${marker}</p>`,
        text: `PHAN-VAN-BAN-${marker}`,
      });

      const found = (await inbox()).find((m) => m.Subject.includes(marker));
      expect(found).toBeDefined();
      expect(found?.To.map((t) => t.Address)).toContain(to);

      /*
       * Đọc CẢ THÂN BÀI: `sendMail` nhận `text` và `html` riêng, và một bản sửa lỡ bỏ mất
       * `text` vẫn gửi thành công — thư tới nơi nhưng trình đọc chỉ-văn-bản thấy trống trơn.
       */
      const raw = await fetch(`${MAILPIT_API}/message/${found!.ID}`);
      const body = (await raw.json()) as { Text: string; HTML: string };
      expect(body.Text).toContain(`PHAN-VAN-BAN-${marker}`);
      expect(body.HTML).toContain(`PHAN-HTML-${marker}`);
    },
    TEST_TIMEOUT,
  );

  it(
    'nhiều người nhận: tất cả đều nằm trong trường To, không rơi mất ai',
    async () => {
      const marker = `E2E-SMTP-MULTI-${Date.now().toString(36)}`;
      const to = [`a-${marker.toLowerCase()}@pmh.local`, `b-${marker.toLowerCase()}@pmh.local`];

      await service.send('IMS <no-reply@pmh.local>', {
        to,
        subject: `IMS nhiều người nhận ${marker}`,
        html: '<p>x</p>',
        text: 'x',
      });

      const found = (await inbox()).find((m) => m.Subject.includes(marker));
      const addresses = found?.To.map((t) => t.Address) ?? [];
      expect(addresses).toEqual(expect.arrayContaining(to));
    },
    TEST_TIMEOUT,
  );

  /**
   * Vế đối chứng cho chính BÀI KIỂM, không phải cho code: nếu Mailpit không chạy hoặc API đổi
   * hình dạng, `inbox()` phải NÉM chứ không trả mảng rỗng. Mảng rỗng sẽ khiến hai bài trên đỏ
   * vì lý do sai, hoặc — tệ hơn, nếu ai đó viết assertion theo chiều ngược — xanh giả.
   */
  it('đọc được hộp thư và nó có cấu trúc như mong đợi', async () => {
    const messages = await inbox();
    expect(Array.isArray(messages)).toBe(true);
  });
});
