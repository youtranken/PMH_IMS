import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { isoDateInTz } from '../../common/today';
import { AuditWriterService } from '../audit/audit-writer.service';
import { SystemConfigService } from '../config-sys/system-config.service';
import { OutboxService } from '../outbox/outbox.service';
import { SweepService } from '../queue/sweep.service';
import {
  describeSchedule,
  localNowIn,
  shouldSendNow,
  type DigestFrequency,
} from './digest-schedule';
import { expiryRuleTable } from './expiry.schema';
import { ExpiryService } from './expiry.service';

export interface DigestRuleInput {
  name?: string;
  kinds?: string[];
  withinDays?: number;
  recipients?: string[];
  frequency?: DigestFrequency;
  hour?: number;
  weekday?: number | null;
  dayOfMonth?: number | null;
  active?: boolean;
}

/** Email đơn giản nhất mà vẫn chặn được lỗi gõ — không đi validate RFC 5322 làm gì. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Báo cáo "sắp hết hạn" gửi theo luật (story 3.5, FR-013).
 *
 * MỘT email tổng hợp cho mỗi luật, KHÔNG mail lẻ từng món: 25 đường ISP mà mỗi đường một
 * email thì tuần sau không ai đọc nữa.
 *
 * Sweep chạy mỗi phút (AD-9): mốc "đến kỳ chưa" derive từ Postgres (`last_sent_at`) chứ
 * không dựa vào Redis còn sống hay không, nên mất Redis vài giờ vẫn gửi bù được.
 */
@Injectable()
export class ExpiryDigestService {
  private readonly logger = new Logger(ExpiryDigestService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly expiry: ExpiryService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditWriterService,
    private readonly config: SystemConfigService,
    sweep: SweepService,
  ) {
    sweep.register({ name: 'expiry-digest', run: () => this.runDue() });
  }

  // ─────────────────────────── Quản trị luật ───────────────────────────

  list() {
    return this.db.select().from(expiryRuleTable).orderBy(asc(expiryRuleTable.name));
  }

  async create(actor: string, input: DigestRuleInput) {
    const values = prepare(input, true);
    return this.db.transaction(async (tx) => {
      const rows = await tx.insert(expiryRuleTable).values(values as never).returning();
      await this.record(tx, actor, 'expiry.rule.created', rows[0].id, values);
      return rows[0];
    });
  }

  async update(actor: string, id: string, input: DigestRuleInput) {
    await this.requireRule(id);
    const values = prepare(input, false);
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(expiryRuleTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(expiryRuleTable.id, id))
        .returning();
      await this.record(tx, actor, 'expiry.rule.updated', id, values);
      return rows[0];
    });
  }

  async remove(actor: string, id: string): Promise<void> {
    const rule = await this.requireRule(id);
    await this.db.transaction(async (tx) => {
      await this.record(tx, actor, 'expiry.rule.deleted', id, { name: rule.name });
      await tx.delete(expiryRuleTable).where(eq(expiryRuleTable.id, id));
    });
  }

  // ─────────────────────────── Gửi ───────────────────────────

  /**
   * Gửi thử NGAY, không đụng `last_sent_at` (AC 3.5: "gửi email test được ngay từ màn
   * cấu hình"). Không có nút này thì người ta phải chờ tới thứ Hai mới biết luật có chạy không.
   */
  async sendTest(actor: string, id: string): Promise<{ recipients: string[]; items: number }> {
    const rule = await this.requireRule(id);
    const recipients = rule.recipients as string[];
    if (recipients.length === 0) {
      throw new BadRequestException({
        code: 'NO_RECIPIENTS',
        message: 'Luật này chưa có người nhận — thêm ít nhất một email rồi thử lại.',
      });
    }
    const payload = await this.buildPayload(rule);
    await this.db.transaction(async (tx) => {
      await this.outbox.enqueueWithin(tx, 'expiry.digest', { ...payload, isTest: true });
      await this.audit.appendWithin(tx, {
        actor,
        action: 'expiry.digest.test',
        objectType: 'expiry_rule',
        objectId: id,
        detail: { recipients: recipients.length, items: payload.items.length },
      });
    });
    return { recipients, items: payload.items.length };
  }

  /** Sweep gọi mỗi phút — chỉ những luật ĐẾN KỲ mới gửi. */
  async runDue(now: Date = new Date()): Promise<void> {
    const timeZone = await this.config.getString('appTimezone');
    const local = localNowIn(timeZone, now);
    const rules = await this.db
      .select()
      .from(expiryRuleTable)
      .where(eq(expiryRuleTable.active, true));

    for (const rule of rules) {
      const lastSentDate = rule.lastSentAt ? isoDateInTz(timeZone, rule.lastSentAt) : null;
      const due = shouldSendNow(
        {
          frequency: rule.frequency as DigestFrequency,
          hour: rule.hour,
          weekday: rule.weekday,
          dayOfMonth: rule.dayOfMonth,
        },
        local,
        lastSentDate,
      );
      if (!due) continue;

      const recipients = rule.recipients as string[];
      if (recipients.length === 0) {
        this.logger.warn(`Luật "${rule.name}" đến kỳ nhưng chưa có người nhận — bỏ qua.`);
        continue;
      }

      const payload = await this.buildPayload(rule);
      // Không có gì sắp hết hạn thì KHÔNG gửi email rỗng — gửi "tuần này không có gì"
      // đều đặn là cách nhanh nhất để mọi người lọc luật này vào thùng rác.
      if (payload.items.length === 0) {
        await this.markSent(rule.id, now);
        continue;
      }

      await this.db.transaction(async (tx) => {
        await this.outbox.enqueueWithin(tx, 'expiry.digest', payload);
        // Đánh dấu đã gửi TRONG CÙNG transaction với việc ghi outbox: tách ra thì
        // crash giữa hai bước sẽ gửi lại mỗi phút cho tới khi có người phát hiện.
        await tx
          .update(expiryRuleTable)
          .set({ lastSentAt: now })
          .where(eq(expiryRuleTable.id, rule.id));
        await this.audit.appendWithin(tx, {
          actor: 'system',
          action: 'expiry.digest.sent',
          objectType: 'expiry_rule',
          objectId: rule.id,
          detail: { items: payload.items.length, recipients: recipients.length },
        });
      });
    }
  }

  /** Nội dung email: bảng các mục sắp hết hạn (FR-013 — tên, loại, start, end, link). */
  private async buildPayload(rule: typeof expiryRuleTable.$inferSelect) {
    const kinds = rule.kinds as string[];
    const { items } = await this.expiry.list({
      withinDays: rule.withinDays,
      kinds: kinds.length > 0 ? kinds : undefined,
    });
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      schedule: describeSchedule({
        frequency: rule.frequency as DigestFrequency,
        hour: rule.hour,
        weekday: rule.weekday,
        dayOfMonth: rule.dayOfMonth,
      }),
      withinDays: rule.withinDays,
      recipients: rule.recipients as string[],
      items: items.map((item) => ({
        label: item.label,
        kind: item.kind,
        start: item.start,
        end: item.end,
        link: item.link,
        daysLeft: item.daysLeft,
      })),
    };
  }

  private async markSent(id: string, now: Date): Promise<void> {
    await this.db
      .update(expiryRuleTable)
      .set({ lastSentAt: now })
      .where(eq(expiryRuleTable.id, id));
  }

  private async requireRule(id: string) {
    const rows = await this.db.select().from(expiryRuleTable).where(eq(expiryRuleTable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'RULE_NOT_FOUND',
        message: 'Không tìm thấy luật gửi báo cáo này.',
      });
    }
    return rows[0];
  }

  private async record(
    tx: Tx,
    actor: string,
    action: string,
    id: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.appendWithin(tx, {
      actor,
      action,
      objectType: 'expiry_rule',
      objectId: id,
      detail,
    });
  }
}

/** Chuẩn hóa + kiểm đầu vào của form luật. */
function prepare(input: DigestRuleInput, isCreate: boolean): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException({ code: 'FIELD_REQUIRED', message: 'Thiếu tên luật.' });
    }
    values.name = name;
  } else if (isCreate) {
    throw new BadRequestException({ code: 'FIELD_REQUIRED', message: 'Thiếu tên luật.' });
  }

  if (input.recipients !== undefined) {
    const emails = input.recipients.map((email) => email.trim()).filter(Boolean);
    const bad = emails.filter((email) => !EMAIL_RE.test(email));
    if (bad.length > 0) {
      throw new BadRequestException({
        code: 'EMAIL_INVALID',
        message: `Email không hợp lệ: ${bad.join(', ')}`,
      });
    }
    values.recipients = emails;
  }

  if (input.kinds !== undefined) values.kinds = input.kinds;
  if (input.withinDays !== undefined) values.withinDays = input.withinDays;
  if (input.active !== undefined) values.active = input.active;
  if (input.hour !== undefined) values.hour = input.hour;

  if (input.frequency !== undefined) {
    values.frequency = input.frequency;
    // Đổi tần suất phải dọn trường của tần suất cũ: giữ lại `weekday` khi chuyển sang
    // "hằng tháng" là để lại dữ liệu vô nghĩa cho người đọc sau này.
    if (input.frequency === 'daily') {
      values.weekday = null;
      values.dayOfMonth = null;
    } else if (input.frequency === 'weekly') {
      values.weekday = input.weekday ?? 1;
      values.dayOfMonth = null;
    } else {
      values.weekday = null;
      values.dayOfMonth = input.dayOfMonth ?? 1;
    }
  } else {
    if (input.weekday !== undefined) values.weekday = input.weekday;
    if (input.dayOfMonth !== undefined) values.dayOfMonth = input.dayOfMonth;
  }

  return values;
}
