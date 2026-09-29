import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { escapeLike } from '../../common/sql';
import { redactMessage } from '../../common/log-redact';
import { HISTORY_PAGE_LIMIT } from '../../common/history';
import type { Page } from '../../common/pagination';
import { ApprovalKindRegistry } from '../../common/approvals/approvals-registry';
import { isGrantActive } from '../../common/approvals/approval-flow';
import { AuditWriterService } from '../audit/audit-writer.service';
import { approvalHistoryTable, approvalTable } from './approvals.schema';

export interface ApprovalRecord {
  id: string;
  kind: string;
  state: string;
  requester: string;
  subjectType: string;
  subjectId: string;
  reason: string;
  payload: Record<string, unknown> | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Tính tại thời điểm đọc bằng đồng hồ, KHÔNG đọc từ DB (AD-6). */
  active: boolean;
  /** Lúc grant được dùng lần đầu và gắn vào một phiên (Q-15); `null` = chưa. Không kèm id phiên. */
  claimedAt: Date | null;
}

export interface ApprovalFilters {
  kind?: string;
  state?: string;
  requester?: string;
  subjectType?: string;
  subjectId?: string;
  /** Chỉ yêu cầu tạo từ mốc này trở đi — lọc trong SQL. */
  since?: Date;
  /** Chỉ yêu cầu tạo TRƯỚC mốc này (loại trừ) — cặp với `since` thành khoảng ngày. */
  until?: Date;
  /** Người xin chứa chuỗi này (không phân biệt hoa thường) — ô lọc của màn nhật ký. */
  requesterContains?: string;
  /**
   * Trạng thái ĐỌC THEO ĐỒNG HỒ (AD-6): phiếu `approved` đã quá `expires_at` mà sweep chưa
   * kịp đổi là "Hết hạn", không phải "Đã duyệt" — lọc theo cột `state` trần thì người rà
   * nhật ký tìm "đang có quyền" lại thấy cả quyền đã hết.
   */
  effectiveState?: string;
}

function whereOf(filters: ApprovalFilters): SQL | undefined {
  const where: SQL[] = [];
  if (filters.kind) where.push(eq(approvalTable.kind, filters.kind));
  if (filters.state) where.push(eq(approvalTable.state, filters.state));
  if (filters.requester) where.push(eq(approvalTable.requester, filters.requester));
  if (filters.subjectType) where.push(eq(approvalTable.subjectType, filters.subjectType));
  if (filters.subjectId) where.push(eq(approvalTable.subjectId, filters.subjectId));
  if (filters.since) where.push(gte(approvalTable.createdAt, filters.since));
  if (filters.until) where.push(lt(approvalTable.createdAt, filters.until));
  if (filters.requesterContains) {
    where.push(sql`${approvalTable.requester} ILIKE ${`%${escapeLike(filters.requesterContains)}%`}`);
  }
  if (filters.effectiveState === 'approved') {
    where.push(
      sql`${approvalTable.state} = 'approved' AND (${approvalTable.expiresAt} IS NULL OR ${approvalTable.expiresAt} > now())`,
    );
  } else if (filters.effectiveState === 'expired') {
    where.push(
      sql`(${approvalTable.state} = 'expired' OR (${approvalTable.state} = 'approved' AND ${approvalTable.expiresAt} <= now()))`,
    );
  } else if (filters.effectiveState) {
    where.push(eq(approvalTable.state, filters.effectiveState));
  }
  return where.length > 0 ? and(...where) : undefined;
}

export interface CreateApprovalInput {
  kind: string;
  requester: string;
  subjectType: string;
  subjectId: string;
  reason: string;
  payload?: Record<string, unknown> | null;
  /** Phiên đăng nhập đang gửi — chỉ để tra vết; quyền gắn phiên lúc dùng lần đầu (Q-15). */
  requesterSessionId?: string | null;
}

export interface TransitionInput {
  to: string;
  actor: string;
  note?: string | null;
  /** Đặt/đổi hạn hiệu lực khi duyệt — người duyệt được phép rút ngắn so với yêu cầu. */
  expiresAt?: Date | null;
  detail?: Record<string, unknown> | null;
}

/**
 * Bộ máy xin–duyệt dùng chung (story 6.1, AD-6).
 *
 * Module này KHÔNG biết break-glass là gì, cũng không biết phiếu ISO là gì. Nó biết cách chạy
 * một máy trạng thái mà loại yêu cầu mang tới, ghi lịch sử, và trả lời câu "cái grant này còn
 * hiệu lực không". Mọi thứ riêng của từng loại nằm ở module chủ.
 */
@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly kinds: ApprovalKindRegistry,
  ) {}

  /**
   * Tạo yêu cầu TRONG transaction của nơi gọi (AD-5).
   *
   * Bắt buộc nhận `tx`: yêu cầu break-glass phải được ghi cùng lúc với dòng outbox báo cho
   * người duyệt. Tách hai transaction thì có cửa sổ mà yêu cầu đã nằm trong DB còn email thì
   * không bao giờ đi — người xin ngồi chờ một người duyệt không hề biết có việc.
   */
  async createWithin(tx: Tx, input: CreateApprovalInput): Promise<ApprovalRecord> {
    const flow = this.requireFlow(input.kind);
    const reason = input.reason.trim();
    if (!reason) {
      throw new BadRequestException({
        code: 'APPROVAL_REASON_REQUIRED',
        message: 'Ghi rõ lý do xin — người duyệt cần biết để quyết.',
      });
    }

    const rows = await tx
      .insert(approvalTable)
      .values({
        kind: input.kind,
        state: flow.initial,
        requester: input.requester,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        reason,
        payload: input.payload ?? null,
        requesterSessionId: input.requesterSessionId ?? null,
      })
      .returning();

    await this.audit.appendWithin(tx, {
      actor: input.requester,
      action: `${input.kind}.requested`,
      objectType: 'approval',
      objectId: rows[0].id,
      detail: { subjectType: input.subjectType, subjectId: input.subjectId, reason },
    });
    await tx.insert(approvalHistoryTable).values({
      approvalId: rows[0].id,
      action: 'Gửi yêu cầu',
      actor: input.requester,
      toState: flow.initial,
      detail: { reason },
    });

    return toRecord(rows[0]);
  }

  /**
   * Đường DUY NHẤT đổi `state` (AD-6: "cấm UPDATE status tự do").
   *
   * Không có `updateState()` nào khác trong cả module — và bảng cũng không có CHECK về từ
   * vựng, nên hàm này là chỗ duy nhất còn biết luật. Mọi bước chuyển ghi một dòng lịch sử và
   * một dòng audit TRONG CÙNG transaction: rollback là mất cả ba, không có chuyện state đã
   * đổi mà vết thì không.
   */
  async transitionWithin(
    tx: Tx,
    id: string,
    input: TransitionInput,
  ): Promise<ApprovalRecord> {
    const before = await this.requireOne(id, tx);
    const flow = this.requireFlow(before.kind);

    if (!flow.can(before.state, input.to)) {
      const allowed = flow.describeNext(before.state);
      throw new BadRequestException({
        code: 'APPROVAL_TRANSITION_INVALID',
        message: allowed
          ? `Không chuyển được sang trạng thái đó. Từ đây chỉ có: ${allowed}.`
          : 'Yêu cầu này đã kết thúc, không đổi được nữa.',
      });
    }

    const decided = input.to !== flow.initial;
    const rows = await tx
      .update(approvalTable)
      .set({
        state: input.to,
        // Chỉ đóng dấu người quyết ở LẦN ĐẦU rời state khởi tạo. Sweep đổi sang `expired`
        // không được ghi đè tên người đã duyệt — nhật ký phải giữ đúng ai là người quyết.
        decidedBy: before.decidedBy ?? (decided ? input.actor : null),
        decidedAt: before.decidedAt ?? (decided ? new Date() : null),
        // Cùng luật với `decidedBy`: ghi chú là lời của người QUYẾT. Lời của người thu hồi về
        // sau chỉ vào lịch sử và audit, không được mượn tên người đã duyệt.
        decisionNote: before.decidedBy
          ? before.decisionNote
          : (decided ? input.note?.trim() || null : before.decisionNote),
        expiresAt: input.expiresAt === undefined ? before.expiresAt : input.expiresAt,
        updatedAt: new Date(),
      })
      /**
       * Điều kiện `state = before.state` ngay trong câu UPDATE.
       *
       * Hai Admin cùng mở một yêu cầu: A bấm Duyệt, B bấm Từ chối. Không có điều kiện này thì
       * cả hai cùng "thành công", lịch sử có hai dòng mâu thuẫn, và state cuối là của người
       * bấm sau — người bấm trước không hề biết quyết định của mình đã bị ghi đè.
       * (Đúng họ với finding 8 của code review Epic 5.)
       */
      .where(and(eq(approvalTable.id, id), eq(approvalTable.state, before.state)))
      .returning();

    if (rows.length === 0) {
      throw new BadRequestException({
        code: 'APPROVAL_ALREADY_DECIDED',
        message: 'Yêu cầu này vừa được người khác xử lý. Tải lại để xem quyết định.',
      });
    }

    const label = flow.label(before.state, input.to) || input.to;
    await this.audit.appendWithin(tx, {
      actor: input.actor,
      action: `${before.kind}.${input.to}`,
      objectType: 'approval',
      objectId: id,
      detail: {
        from: before.state,
        to: input.to,
        note: input.note ?? null,
        expiresAt: rows[0].expiresAt?.toISOString() ?? null,
      },
    });
    await tx.insert(approvalHistoryTable).values({
      approvalId: id,
      action: label,
      actor: input.actor,
      fromState: before.state,
      toState: input.to,
      detail: { note: input.note ?? null, ...(input.detail ?? {}) },
    });

    return toRecord(rows[0]);
  }

  /** Bản chạy ngoài transaction — dùng cho thao tác đứng một mình (duyệt/từ chối trên UI). */
  transition(id: string, input: TransitionInput): Promise<ApprovalRecord> {
    return this.db.transaction((tx) => this.transitionWithin(tx, id, input));
  }

  async findOne(id: string): Promise<ApprovalRecord> {
    return toRecord(await this.requireOne(id));
  }

  async history(id: string): Promise<(typeof approvalHistoryTable.$inferSelect)[]> {
    await this.requireOne(id);
    return this.db
      .select()
      .from(approvalHistoryTable)
      .where(eq(approvalHistoryTable.approvalId, id))
      .orderBy(desc(approvalHistoryTable.createdAt))
      .limit(HISTORY_PAGE_LIMIT);
  }

  /**
   * Toàn bộ yêu cầu khớp bộ lọc. Chỉ dùng khi bộ lọc tự giới hạn (một người trên một đối tượng
   * đang chờ) hoặc khi cần đủ lịch sử thật (file xuất cho auditor). Màn hình và trang chủ đi
   * qua `page()`: bảng này chỉ lớn lên, tải hết rồi cắt trong JS thì mỗi lần mở trang chủ đọc
   * lại cả lịch sử.
   */
  async list(filters: ApprovalFilters): Promise<ApprovalRecord[]> {
    const rows = await this.db
      .select()
      .from(approvalTable)
      .where(whereOf(filters))
      .orderBy(desc(approvalTable.createdAt));
    return rows.map(toRecord);
  }

  /** Một trang, mới nhất trước; `total` đếm cả bộ lọc (kể cả `since`) chứ không phải trang. */
  async page(
    filters: ApprovalFilters,
    paging: { limit: number; offset: number },
  ): Promise<Page<ApprovalRecord>> {
    const where = whereOf(filters);
    const [rows, counted] = await Promise.all([
      this.db
        .select()
        .from(approvalTable)
        .where(where)
        .orderBy(desc(approvalTable.createdAt), desc(approvalTable.id))
        .limit(paging.limit)
        .offset(paging.offset),
      this.db.select({ n: sql<number>`count(*)::int` }).from(approvalTable).where(where),
    ]);
    return { items: rows.map(toRecord), total: counted[0].n };
  }

  /**
   * Grant CÒN HIỆU LỰC của một người trên một đối tượng.
   *
   * Trả về bản ghi chứ không trả boolean: nơi gọi cần `id` để ghi vào dòng audit "xem secret
   * bằng grant nào" — không có nó thì nhật ký break-glass đứt đúng ở khúc quan trọng nhất.
   */
  async activeGrantFor(params: {
    kind: string;
    requester: string;
    subjectType: string;
    subjectId: string;
    /**
     * Phiên đang giữ grant (Q-15): chuỗi = chỉ grant đã gắn đúng phiên này; `null` = chỉ grant
     * CHƯA gắn phiên nào; bỏ trống = mọi grant.
     */
    holderSessionId?: string | null;
    now?: Date;
  }): Promise<ApprovalRecord | null> {
    const rows = await this.db
      .select()
      .from(approvalTable)
      .where(
        and(
          eq(approvalTable.kind, params.kind),
          eq(approvalTable.requester, params.requester),
          eq(approvalTable.subjectType, params.subjectType),
          eq(approvalTable.subjectId, params.subjectId),
          eq(approvalTable.state, 'approved'),
          params.holderSessionId === undefined
            ? undefined
            : params.holderSessionId === null
              ? isNull(approvalTable.claimedSessionId)
              : eq(approvalTable.claimedSessionId, params.holderSessionId),
        ),
      )
      .orderBy(desc(approvalTable.expiresAt));

    const now = params.now ?? new Date();
    /**
     * Lọc bằng `isGrantActive` ở tầng ứng dụng, KHÔNG bằng `expires_at > now()` trong SQL.
     *
     * Cùng một hàm mà máy trạng thái và test bảng dữ liệu đang dùng — nên "còn hiệu lực" chỉ
     * có MỘT định nghĩa trong cả hệ thống. Viết lại điều kiện đó bằng SQL ở đây là mở đường
     * cho hai định nghĩa trôi khỏi nhau (vd một bên dùng `>`, bên kia `>=`).
     */
    return rows.map(toRecord).find((row) => isGrantActive(row.state, row.expiresAt, now)) ?? null;
  }

  /**
   * Vệ sinh: đổi `approved` đã quá hạn sang `expired`.
   *
   * AD-6 nói rõ đây CHỈ là vệ sinh — quyền đã bị cắt từ lúc `expires_at` trôi qua, vì mọi
   * đường đọc đều gọi `isGrantActive`. Sweep này chết thì danh sách hiển thị hơi bẩn, chứ
   * không ai xem lén được gì.
   */
  async expireDueGrants(now: Date = new Date()): Promise<number> {
    const due = await this.db
      .select()
      .from(approvalTable)
      .where(
        and(
          eq(approvalTable.state, 'approved'),
          isNotNull(approvalTable.expiresAt),
          lt(approvalTable.expiresAt, now),
        ),
      );

    let closed = 0;
    for (const row of due) {
      const flow = this.kinds.find(row.kind);
      // Loại chưa đăng ký (module tắt, đổi tên) → bỏ qua, KHÔNG làm chết cả vòng quét.
      if (!flow?.can(row.state, 'expired')) continue;
      try {
        await this.db.transaction(async (tx) => {
          await this.transitionWithin(tx, row.id, {
            to: 'expired',
            actor: 'system',
            detail: { by: 'sweep' },
          });
        });
        closed += 1;
      } catch (error) {
        // Mỗi hàng một transaction riêng: hàng lỗi tự rollback và vòng sau thử lại, còn các hàng
        // khác vẫn phải được đóng — một hàng hỏng không được làm bẩn cả danh sách.
        this.logger.warn(`hết hạn grant ${row.id} lỗi: ${redactMessage(error)}`);
      }
    }
    return closed;
  }

  /**
   * Gắn grant vào phiên đang dùng nó lần đầu (Q-15), TRONG transaction của nơi gọi. Trả `null`
   * khi grant không gắn được nữa: đã gắn phiên khác, không còn `approved`, hay đã hết giờ.
   *
   * Điều kiện `claimed_session_id IS NULL` nằm ngay trong câu UPDATE: hai phiên cùng dùng lần
   * đầu thì đúng một câu UPDATE thấy hàng còn trống, câu kia nhận 0 hàng — đọc-rồi-ghi thì cả hai
   * cùng thấy "chưa ai giữ" và phiên ghi sau cướp quyền của phiên ghi trước.
   */
  async claimWithin(
    tx: Tx,
    id: string,
    input: { actor: string; sessionId: string; now?: Date },
  ): Promise<ApprovalRecord | null> {
    const now = input.now ?? new Date();
    const before = await this.requireOne(id, tx);
    // Hạn đọc bằng đúng `isGrantActive` — một định nghĩa "còn hiệu lực" cho cả hệ thống.
    if (!isGrantActive(before.state, before.expiresAt, now)) return null;
    const rows = await tx
      .update(approvalTable)
      .set({ claimedSessionId: input.sessionId, claimedAt: now, updatedAt: now })
      .where(
        and(
          eq(approvalTable.id, id),
          eq(approvalTable.state, 'approved'),
          isNull(approvalTable.claimedSessionId),
        ),
      )
      .returning();
    if (rows.length === 0) return null;

    await this.audit.appendWithin(tx, {
      actor: input.actor,
      action: `${before.kind}.claimed`,
      objectType: 'approval',
      objectId: id,
      detail: { expiresAt: before.expiresAt?.toISOString() ?? null },
    });
    // `to_state` để trống: state không đổi, dòng này chỉ ghi "đã bắt đầu dùng ở một phiên".
    await tx.insert(approvalHistoryTable).values({
      approvalId: id,
      action: 'Xem lần đầu — quyền gắn vào phiên đăng nhập',
      actor: input.actor,
      fromState: before.state,
      toState: null,
      detail: { event: 'claimed' },
    });
    return toRecord(rows[0]);
  }

  /** Grant đã gắn phiên của một loại — cho lượt quét đóng quyền của phiên đã kết thúc (Q-15). */
  async claimedGrants(kind: string): Promise<{ id: string; claimedSessionId: string }[]> {
    const rows = await this.db
      .select({ id: approvalTable.id, claimedSessionId: approvalTable.claimedSessionId })
      .from(approvalTable)
      .where(
        and(
          eq(approvalTable.kind, kind),
          eq(approvalTable.state, 'approved'),
          isNotNull(approvalTable.claimedSessionId),
        ),
      );
    return rows.map((r) => ({ id: r.id, claimedSessionId: r.claimedSessionId as string }));
  }

  /**
   * Rút mọi phiếu còn sống của một người, TRONG transaction của nơi gọi — khi tài khoản bị vô
   * hiệu hóa (Q-15). Chỉ các (loại, state) khai trong `withdrawOnRequesterDisabled`; lọc ngay
   * trong SQL vì câu này chạy khi đang giữ khóa hàng của lượt vô hiệu hóa, và người lâu năm có
   * hàng trăm phiếu cũ đã đóng. Mỗi phiếu đi qua `transitionWithin` nên có đủ lịch sử + audit.
   */
  async withdrawPendingOfWithin(
    tx: Tx,
    requester: string,
    input: { actor: string; note: string },
  ): Promise<number> {
    const targets = new Map<string, Record<string, string>>();
    const scopes: SQL[] = [];
    for (const kind of this.kinds.kinds()) {
      const target = this.kinds.find(kind)?.withdrawOnRequesterDisabled ?? {};
      const states = Object.keys(target);
      if (states.length === 0) continue;
      targets.set(kind, target);
      scopes.push(sql`(${approvalTable.kind} = ${kind} AND ${inArray(approvalTable.state, states)})`);
    }
    if (scopes.length === 0) return 0;
    const rows = await tx
      .select({ id: approvalTable.id, kind: approvalTable.kind, state: approvalTable.state })
      .from(approvalTable)
      .where(
        and(sql`lower(${approvalTable.requester}) = lower(${requester})`, or(...scopes)),
      );
    for (const row of rows) {
      await this.transitionWithin(tx, row.id, {
        to: targets.get(row.kind)?.[row.state] ?? row.state,
        actor: input.actor,
        note: input.note,
        detail: { by: 'account-disabled' },
      });
    }
    return rows.length;
  }

  /** Yêu cầu đang treo — sweep nhắc và màn "cần duyệt" đều dùng. */
  async pending(kind?: string): Promise<ApprovalRecord[]> {
    const where: SQL[] = [eq(approvalTable.state, 'pending')];
    if (kind) where.push(eq(approvalTable.kind, kind));
    const rows = await this.db
      .select()
      .from(approvalTable)
      .where(and(...where))
      .orderBy(approvalTable.createdAt);
    return rows.map(toRecord);
  }

  /**
   * Chốt lượt nhắc một cách NGUYÊN TỬ và trả về có chốt được không.
   *
   * `UPDATE … WHERE payload->>'remindedAt' IS NULL RETURNING` — ai chốt được thì người đó gửi.
   * Đọc-rồi-ghi thì hai worker cùng thấy "chưa nhắc" và người duyệt lãnh hai email giống hệt
   * nhau (đúng finding 3 của code review Epic 3, cùng một hình dạng lỗi).
   */
  async claimReminderWithin(tx: Tx, id: string, now: Date): Promise<boolean> {
    const rows = await tx
      .update(approvalTable)
      .set({
        payload: sql`coalesce(${approvalTable.payload}, '{}'::jsonb) || jsonb_build_object('remindedAt', ${now.toISOString()}::text)`,
        updatedAt: now,
      })
      .where(
        and(
          eq(approvalTable.id, id),
          eq(approvalTable.state, 'pending'),
          sql`${approvalTable.payload} ->> 'remindedAt' IS NULL`,
        ),
      )
      .returning({ id: approvalTable.id });
    return rows.length > 0;
  }

  /** Cho sweep mở transaction bao cả việc chốt lượt nhắc lẫn việc ghi outbox (AD-5). */
  runInTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  private requireFlow(kind: string) {
    const flow = this.kinds.find(kind);
    if (!flow) {
      throw new BadRequestException({
        code: 'APPROVAL_KIND_UNKNOWN',
        message: `Loại yêu cầu "${kind}" chưa được khai báo trong hệ thống.`,
      });
    }
    return flow;
  }

  private async requireOne(
    id: string,
    tx?: Tx,
  ): Promise<typeof approvalTable.$inferSelect> {
    const runner = tx ?? this.db;
    const rows = await runner.select().from(approvalTable).where(eq(approvalTable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'APPROVAL_NOT_FOUND',
        message: 'Không tìm thấy yêu cầu này.',
      });
    }
    return rows[0];
  }
}

function toRecord(row: typeof approvalTable.$inferSelect): ApprovalRecord {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    requester: row.requester,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    reason: row.reason,
    payload: row.payload as Record<string, unknown> | null,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // Tính bằng ĐỒNG HỒ tại thời điểm đọc (AD-6) — không phải một cột trong DB.
    active: isGrantActive(row.state, row.expiresAt),
    claimedAt: row.claimedAt,
  };
}
