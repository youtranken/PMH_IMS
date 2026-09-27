import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, lt, or } from 'drizzle-orm';
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
  startOfLocalDayUtc,
  type DigestFrequency,
} from './digest-schedule';
import { expiryRuleTable } from './expiry.schema';
import { ExpiryService } from './expiry.service';
import { redactMessage } from '../../common/log-redact';

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
    const values = prepareDigestRule(input, true, this.knownKinds());
    return this.db.transaction(async (tx) => {
      const rows = await tx.insert(expiryRuleTable).values(values as never).returning();
      await this.record(tx, actor, 'expiry.rule.created', rows[0].id, values);
      return rows[0];
    });
  }

  async update(actor: string, id: string, input: DigestRuleInput) {
    await this.requireRule(id);
    const values = prepareDigestRule(input, false, this.knownKinds());
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
      await this.outbox.enqueueWithin(tx, 'expiry.digest', { ruleId: id, isTest: true });
      await this.audit.appendWithin(tx, {
        actor,
        action: 'expiry.digest.test',
        objectType: 'expiry_rule',
        objectId: id,
        detail: { recipients: recipients.length, items: payload.total },
      });
    });
    return { recipients, items: payload.total };
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
      try {
        await this.runOne(rule, local, timeZone, now);
      } catch (error) {
        // Một luật hỏng KHÔNG được chặn các luật sau. `SweepService` chỉ bắt lỗi ở mức
        // handler, nên để lỗi thoát ra đây là mọi luật xếp sau ngừng gửi mà tín hiệu duy
        // nhất là một dòng log mỗi phút (code review Epic 3).
        this.logger.error(
          `Luật "${rule.name}" lỗi khi gửi báo cáo: ${redactMessage(error)}`,
        );
      }
    }
  }

  private async runOne(
    rule: typeof expiryRuleTable.$inferSelect,
    local: ReturnType<typeof localNowIn>,
    timeZone: string,
    now: Date,
  ): Promise<void> {
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
    if (!due) return;

    const recipients = rule.recipients as string[];
    /*
     * Dựng nội dung TRƯỚC khi mở transaction — đây là câu đọc thuần, không cần nằm trong tx,
     * và để nó ngoài thì transaction chốt kỳ giữ khóa ngắn nhất có thể. Ai thua cuộc đua chốt
     * kỳ bên dưới thì chỉ phí một lượt đọc, mỗi kỳ một lần, không đáng kể.
     */
    const payload = recipients.length > 0 ? await this.buildPayload(rule) : null;

    /*
     * ĐẦU NGÀY THEO MÚI GIỜ ỨNG DỤNG. Bản trước là `new Date(`${local.date}T00:00:00Z`)` —
     * dán nửa đêm UTC vào một chuỗi ngày ĐỊA PHƯƠNG, tức 7 giờ sáng cùng ngày ở Việt Nam. Với
     * mọi luật hẹn giờ 0..6, câu UPDATE giành kỳ bên dưới im lặng cho giành LẦN NỮA, và trọng
     * tài "nhiều nhất một lần" mất tác dụng đúng ở khung giờ người ta hay chọn nhất cho báo
     * cáo đầu ngày. Xem `startOfLocalDayUtc`.
     */
    const startOfDayUtc = startOfLocalDayUtc(timeZone, local.date);
    await this.db.transaction(async (tx) => {
      /*
       * CHỐT KỲ và ĐẨY VÀO OUTBOX TRONG CÙNG MỘT TRANSACTION.
       *
       * Hai tính chất phải giữ cùng lúc, và bản trước chỉ giữ được một:
       *
       * 1. "Nhiều nhất một lần" — câu UPDATE có điều kiện `last_sent_at < đầu ngày` là trọng
       *    tài. Hai worker cùng thấy "đến kỳ" thì chỉ một câu UPDATE trúng row; người thua
       *    nhận 0 hàng và im lặng rút. Tính chất này bản trước ĐÃ có.
       *
       * 2. "Ít nhất một lần" — bản trước chốt kỳ bằng `this.db` (tự commit ngay), rồi mở một
       *    transaction KHÁC để đẩy outbox. Nếu transaction thứ hai hỏng — outbox lỗi, mạng
       *    DB chớp, worker bị kill giữa chừng — thì `last_sent_at` ĐÃ nhảy sang kỳ mới trong
       *    khi không có thư nào được xếp hàng. Kỳ báo cáo đó mất VĨNH VIỄN: lần chạy sau
       *    thấy `last_sent_at` là hôm nay nên không đến kỳ nữa. Không có gì đỏ, không có gì
       *    trong log, chỉ là người nhận không bao giờ nhận được thư của kỳ đó.
       *
       * Gộp chung một tx thì hỏng ở đâu cũng rollback cả chốt kỳ — kỳ vẫn "chưa gửi" và lần
       * chạy sau làm lại. Đây đúng nếp mà `approval-sweep.service.ts` đã dùng (claim + outbox
       * cùng tx).
       */
      const claimed = await tx
        .update(expiryRuleTable)
        .set({ lastSentAt: now })
        .where(
          and(
            eq(expiryRuleTable.id, rule.id),
            or(
              isNull(expiryRuleTable.lastSentAt),
              lt(expiryRuleTable.lastSentAt, startOfDayUtc),
            ),
          ),
        )
        .returning({ id: expiryRuleTable.id });
      if (claimed.length === 0) return; // worker khác đã chốt kỳ này

      if (payload === null) {
        // Không nên xảy ra (luật đang chạy bắt buộc có người nhận), nhưng dữ liệu cũ có thể
        // còn. Kỳ vẫn được chốt (commit) nên chỉ cảnh báo MỘT LẦN cho kỳ này, không mỗi phút.
        this.logger.warn(`Luật "${rule.name}" đến kỳ nhưng chưa có người nhận — bỏ qua kỳ này.`);
        return;
      }
      // Không có gì cần chú ý thì KHÔNG gửi thư rỗng — gửi "tuần này không có gì" đều đặn là
      // cách nhanh nhất để mọi người lọc luật này vào thùng rác. Kỳ vẫn chốt: đã xét rồi.
      if (payload.total === 0) return;

      // AD-11/NFR-04: outbox chỉ giữ ID THAM CHIẾU, không PII. Địa chỉ email và tên hồ sơ
      // được consumer dựng lại từ `ruleId` — nếu nhét vào đây thì chúng còn chui sang cả
      // job data của Redis (relay copy nguyên payload).
      await this.outbox.enqueueWithin(tx, 'expiry.digest', { ruleId: rule.id });
      await this.audit.appendWithin(tx, {
        actor: 'system',
        action: 'expiry.digest.sent',
        objectType: 'expiry_rule',
        objectId: rule.id,
        detail: { items: payload.total, recipients: recipients.length },
      });
    });
  }

  /**
   * Nội dung email (FR-013 — tên, loại, start, end, link).
   *
   * Public vì consumer mail dựng lại nội dung TỪ `ruleId`: outbox chỉ được giữ id tham
   * chiếu, không PII (AD-11/NFR-04).
   */
  async buildDigest(ruleId: string) {
    return this.buildPayload(await this.requireRule(ruleId));
  }

  private async buildPayload(rule: typeof expiryRuleTable.$inferSelect) {
    const kinds = rule.kinds as string[];
    /*
     * Email KHÔNG nhìn lùi một năm như màn hình (rà soát 07/09, mục 6 "Miền nghiệp vụ").
     *
     * Bản trước để `includeExpired` trống nên rơi về mặc định của MÀN HÌNH: nhìn lùi 365 ngày.
     * Với một thứ gửi hằng tuần thì đó là 52 lá thư liên tiếp cùng chứa một tên miền công ty
     * đã bỏ. Không ai xử được nó BẰNG EMAIL — việc phải làm nằm ở màn khác — nên nó chỉ dạy
     * người nhận rằng thư này có thứ không cần đọc, và vài tuần sau cả lá thư vào thùng rác,
     * kể cả những dòng thật sự gấp.
     */
    const { items } = await this.expiry.list({
      withinDays: rule.withinDays,
      kinds: kinds.length > 0 ? kinds : undefined,
      expiredWithinDays: await this.config.getNumber('expiryDigestExpiredDays'),
    });
    const rows = items.filter((item) => !item.quietInDigest).map((item) => ({
      label: item.label,
      kind: item.kind,
      start: item.start,
      end: item.end,
      link: item.link,
      daysLeft: item.daysLeft,
    }));
    // Tách hai con số: thư gọi tất cả là "sắp hết hạn" trong khi thân thư ghi "ĐÃ QUÁ HẠN
    // 200 ngày" thì người đọc mất tin vào cái tiêu đề (code review Epic 3).
    const expired = rows.filter((row) => row.daysLeft < 0).length;
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
      items: rows,
      total: rows.length,
      expired,
      upcoming: rows.length - expired,
    };
  }

  private knownKinds(): string[] {
    return this.expiry.kinds().map((k) => k.kind);
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
export function prepareDigestRule(
  input: DigestRuleInput,
  isCreate: boolean,
  knownKinds: string[],
): Record<string, unknown> {
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
    // Luật ĐANG CHẠY mà không có người nhận thì mỗi phút sweep lại đến kỳ, lại bỏ qua, lại
    // ghi một dòng cảnh báo — gần một nghìn dòng rác mỗi ngày mà không ai nhận được gì.
    // Chặn ở đây; muốn để dành thì bỏ tick "Đang chạy".
    const active = input.active ?? true;
    if (active && emails.length === 0) {
      throw new BadRequestException({
        code: 'NO_RECIPIENTS',
        message:
          'Luật đang chạy phải có ít nhất một người nhận. Bỏ tick "Đang chạy" nếu muốn tạm để đó.',
      });
    }
  }

  if (input.kinds !== undefined) {
    const unknown = input.kinds.filter((kind) => !knownKinds.includes(kind));
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'RULE_KIND_UNKNOWN',
        message: `Không có loại hạn: ${unknown.join(', ')}. Chọn trong danh sách loại đang có.`,
      });
    }
    values.kinds = input.kinds;
  }
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
