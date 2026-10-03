import { ApprovalKindRegistry } from '../../common/approvals/approvals-registry';
import { MailContentRegistry } from '../../common/mail-content.registry';
import { MailConsumer } from './mail.consumer';
import type { OutboxService } from '../outbox/outbox.service';
import type { UsersApiService } from '../users/users.api';
import type { MailTransportService } from './mail-transport.service';
import type { SystemConfigService } from '../config-sys/system-config.service';
import type { ExpiryApiService } from '../expiry/expiry.api';
import type { ApprovalsApiService } from '../approvals/approvals.api';

/**
 * Thư mà module chủ dữ liệu dựng qua `MailContentRegistry` (thư lệch kho bản vẽ): consumer bọc
 * khuôn + nút, gửi đúng người module chủ trả về; module chủ trả `null` thì không gửi gì nhưng hàng
 * outbox vẫn được đánh dấu xong.
 */

type Sent = { to: string[]; subject: string; text: string; html: string };

async function send(topic: string, payload: Record<string, unknown>, contents: MailContentRegistry) {
  const sent: Sent[] = [];
  const processed: string[] = [];
  const outbox = {
    loadForConsumer: () => Promise.resolve({ payload, createdAt: new Date('2026-10-03T00:00:00Z'), processedAt: null }),
    markProcessed: (id: string) => {
      processed.push(id);
      return Promise.resolve();
    },
  } as unknown as OutboxService;
  const transport = {
    send: (_from: string, message: Sent) => {
      sent.push(message);
      return Promise.resolve();
    },
  } as unknown as MailTransportService;
  const config = { getString: (key: string) => Promise.resolve(key === 'appTimezone' ? 'Asia/Ho_Chi_Minh' : 'ims@pmh.com.vn') } as unknown as SystemConfigService;
  await new MailConsumer(
    outbox,
    {} as UsersApiService,
    transport,
    config,
    {} as ExpiryApiService,
    {} as ApprovalsApiService,
    new ApprovalKindRegistry(),
    contents,
  ).handle(topic, 'o1');
  return { sent, processed };
}

describe('Thư dựng qua MailContentRegistry', () => {
  it('diagram.drift: gửi đúng người nhận, tiêu đề, dòng và nút tới bản vẽ', async () => {
    const contents = new MailContentRegistry();
    const seen: Record<string, unknown>[] = [];
    contents.register('diagram.drift', (payload) => {
      seen.push(payload);
      return Promise.resolve({
        to: ['owner@pmh.com.vn'],
        subject: '[IMS] Bản vẽ "Tầng 3" lệch kho: 3 mục',
        title: 'Bản vẽ lệch kho',
        intro: 'Kho đã đổi khác lúc vẽ.',
        rows: [{ label: 'Số mục lệch', value: '3 (lần trước 1)' }],
        ctaLabel: 'Mở bản vẽ',
        ctaPath: '/diagrams/dg1',
      });
    });
    const { sent, processed } = await send('diagram.drift', { diagramId: 'dg1', count: 3, previous: 1 }, contents);
    expect(seen).toEqual([{ diagramId: 'dg1', count: 3, previous: 1 }]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['owner@pmh.com.vn']);
    expect(sent[0].subject).toBe('[IMS] Bản vẽ "Tầng 3" lệch kho: 3 mục');
    expect(sent[0].text).toContain('3 (lần trước 1)');
    expect(sent[0].html).toContain('/diagrams/dg1');
    expect(processed).toEqual(['o1']);
  });

  it('module chủ trả null (bản vẽ đã lưu trữ, không người nhận) → không gửi, vẫn đánh dấu xong', async () => {
    const contents = new MailContentRegistry();
    contents.register('diagram.drift', () => Promise.resolve(null));
    const { sent, processed } = await send('diagram.drift', { diagramId: 'dg1' }, contents);
    expect(sent).toEqual([]);
    expect(processed).toEqual(['o1']);
  });
});
