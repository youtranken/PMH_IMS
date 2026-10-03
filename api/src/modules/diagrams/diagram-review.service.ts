import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { ApprovalKindRegistry, type ApprovalSubject } from '../../common/approvals/approvals-registry';
import { secretTextMessage } from '../../common/no-secret-text';
import { textLooksLikeSecret } from '../../common/note-secret';
import type { Tx } from '../../common/tx';
import { UI_PATHS } from '../../common/ui-paths';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { ApprovalsApiService, type ApprovalRecord } from '../approvals/approvals.api';
import { AuditWriterService } from '../audit/audit-writer.service';
import type { UserRole } from '../auth/types';
import { DevicesApiService } from '../devices/devices.api';
import { OutboxService } from '../outbox/outbox.service';
import { UsersApiService } from '../users/users.api';
import { diffCellIndex, summarizeDiff, type CellIndex, type CellKind } from './diagram-cells';
import type { CheckLink, Finding } from './diagram-finding';
import { runDiagramChecks, type CheckDevice, type CheckResult } from './diagram-selfcheck';
import {
  diagramCommentTable,
  diagramHistoryTable,
  diagramTable,
  diagramVersionTable,
  type CommentAnchor,
  type DiagramCommentKind,
} from './diagram.schema';
import { DiagramsService, type DiagramNode, type DiagramStatus } from './diagrams.service';

export const DIAGRAM_PUBLISH_KIND = 'diagram_publish';

/**
 * Từ vựng của yêu cầu phát hành bản vẽ (AD-6, Q-23). Trả về là trạng thái cuối của MỘT lượt gửi:
 * người gửi sửa xong thì gửi lượt mới, không mở lại lượt cũ — lịch sử duyệt đọc được từng vòng.
 */
export const DIAGRAM_PUBLISH_FLOW = {
  kind: DIAGRAM_PUBLISH_KIND,
  initial: 'pending',
  transitions: {
    pending: ['approved', 'returned', 'withdrawn'],
    approved: [],
    returned: [],
    withdrawn: [],
  },
  labels: {
    'pending->approved': 'Duyệt — thành bản chính thức',
    'pending->returned': 'Trả về kèm ghi chú',
    'pending->withdrawn': 'Người gửi rút',
  },
  // Tài khoản người gửi bị vô hiệu hoá thì yêu cầu chờ bị rút như người gửi tự rút (Q-15).
  withdrawOnRequesterDisabled: { pending: 'withdrawn' },
};

type DeviceMap = Awaited<ReturnType<DevicesApiService['getByIds']>>;

/** Phiên bản mà yêu cầu duyệt trỏ tới — ghi lúc gửi, không đổi theo lần lưu sau. */
function payloadVersionId(request: ApprovalRecord): string {
  const value = request.payload?.versionId;
  return typeof value === 'string' ? value : '';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Reviewer {
  email: string;
  role: UserRole;
}

export type ReviewedStatus = DiagramStatus | 'pending';

/** Nút cây kèm trạng thái duyệt: "chờ duyệt" và số phiên bản chính thức (Q-23). */
export interface ReviewedNode extends Omit<DiagramNode, 'status'> {
  status: ReviewedStatus;
  officialSeq: number | null;
  pendingApprovalId: string | null;
}

export interface SubmitInput {
  reason: string;
  /** Mặc định phiên bản mới nhất. */
  versionId?: string;
}

export interface PublishResult {
  versionId: string;
  seq: number;
  warnings: Finding[];
}

export interface CommentInput {
  versionId: string;
  cellId?: string | null;
  anchor?: CommentAnchor | null;
  body: string;
  parentId?: string | null;
}

export interface CommentRow {
  id: string;
  versionId: string;
  approvalId: string | null;
  parentId: string | null;
  kind: DiagramCommentKind;
  cellId: string | null;
  anchor: CommentAnchor | null;
  body: string | null;
  author: string;
  authorName: string | null;
  createdAt: string;
}

export interface CommentThread extends CommentRow {
  /** Phiên bản của ghim — web so với phiên bản đang xem để biết "(hình đã bỏ)". */
  versionSeq: number | null;
  resolved: boolean;
  replies: CommentRow[];
}

export interface ReviewPage {
  approval: (ApprovalRecord & { requesterName: string }) | null;
  versionId: string | null;
  seq: number | null;
  officialSeq: number | null;
  /** Một dòng so với bản chính thức (Q-23: không bắt bấm qua từng thay đổi). */
  summary: string | null;
  errors: Finding[];
  warnings: Finding[];
  /** Mọi ô của phiên bản — trình xem cho bấm vào để ghim. */
  cells: { id: string; kind: CellKind; label: string }[];
}

function checkFailed(result: CheckResult, action: string): BadRequestException {
  return new BadRequestException({
    code: 'DIAGRAM_CHECK_FAILED',
    message: `Bản vẽ còn ${result.errors.length} lỗi phải sửa trước khi ${action}: ${result.errors[0].message}`,
    errors: result.errors,
    warnings: result.warnings,
  });
}

function notFound(): NotFoundException {
  return new NotFoundException({ code: 'APPROVAL_NOT_FOUND', message: 'Không tìm thấy yêu cầu duyệt này của bản vẽ.' });
}

function managerOnly(): ForbiddenException {
  return new ForbiddenException({ code: 'DIAGRAM_PUBLISH_FORBIDDEN', message: 'Chỉ Admin/SA duyệt hoặc phát hành bản vẽ.' });
}

/**
 * Gửi duyệt, duyệt, trả về, phát hành và bình luận ghim của bản vẽ (Q-23, AD-6, AD-18).
 *
 * Duyệt đi qua `approvals.api` với loại `diagram_publish`; đổi cờ chính thức (`diagram.official_
 * version_id`), lịch sử, nhật ký, trạng thái yêu cầu và thư báo nằm trong CÙNG một transaction
 * (AD-5). Phát hành không ghi gì vào `device_port` (AD-18).
 */
@Injectable()
export class DiagramReviewService implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly diagrams: DiagramsService,
    private readonly devices: DevicesApiService,
    private readonly approvals: ApprovalsApiService,
    private readonly outbox: OutboxService,
    private readonly users: UsersApiService,
    private readonly kinds: ApprovalKindRegistry,
  ) {}

  onModuleInit(): void {
    this.kinds.register(DIAGRAM_PUBLISH_FLOW);
    // `mail` và nhật ký là tầng nền, không import được `diagrams` — dạy sổ cách gọi tên bản vẽ.
    this.kinds.registerDescriber(DIAGRAM_PUBLISH_KIND, (_type, id) => this.describe(id));
  }

  private async describe(diagramId: string): Promise<ApprovalSubject | null> {
    const [row] = await this.db.select({ name: diagramTable.name }).from(diagramTable).where(eq(diagramTable.id, diagramId));
    if (!row) return null;
    const path = UI_PATHS.diagram(diagramId);
    return { code: row.name, label: `Bản vẽ ${row.name}`, path, detailPath: path };
  }

  /* --------------------------------------------------------- trạng thái cây --- */

  /**
   * Cây + trạng thái duyệt. Yêu cầu chờ đọc qua `approvals.api` (một lượt cho cả cây), số phiên
   * bản chính thức đọc ở bảng của chính module.
   */
  async overlay(nodes: DiagramNode[]): Promise<ReviewedNode[]> {
    if (nodes.length === 0) return [];
    const ids = new Set(nodes.map((n) => n.id));
    const pending = new Map(
      (await this.approvals.pending(DIAGRAM_PUBLISH_KIND)).filter((a) => ids.has(a.subjectId)).map((a) => [a.subjectId, a.id]),
    );
    const official = await this.db
      .select({ diagramId: diagramTable.id, seq: diagramVersionTable.seq })
      .from(diagramTable)
      .innerJoin(diagramVersionTable, eq(diagramVersionTable.id, diagramTable.officialVersionId))
      .where(inArray(diagramTable.id, [...ids]));
    const seqOf = new Map(official.map((r) => [r.diagramId, r.seq]));
    return nodes.map((node) => {
      const pendingApprovalId = pending.get(node.id) ?? null;
      return {
        ...node,
        status: pendingApprovalId ? 'pending' : node.status,
        officialSeq: seqOf.get(node.id) ?? null,
        pendingApprovalId,
      };
    });
  }

  /* ------------------------------------------------------------ tự kiểm --- */

  /** Tự kiểm một chỉ mục ô với dữ liệu kho HIỆN TẠI (đọc qua public api — AD-2). */
  async check(index: CellIndex): Promise<CheckResult> {
    const ids = [...new Set(index.cells.map((c) => c.deviceId).filter((id): id is string => Boolean(id && UUID_RE.test(id))))];
    const found: DeviceMap = ids.length > 0 ? await this.devices.getByIds(ids) : (new Map() as DeviceMap);
    const devices = new Map<string, CheckDevice>(
      [...found.values()].map((d) => [d.id, { id: d.id, code: d.code, status: d.status, cabinetId: d.cabinetId }]),
    );
    return runDiagramChecks({ index, devices, links: await this.loadCheckLinks(index) });
  }

  /**
   * Dòng sơ đồ cổng theo `ims_link_id` của các dây trên bản vẽ, cho luật dây (`checkCables`).
   * Đọc qua endpoint đọc của `devices` khi phần dây gắn sơ đồ cổng có; chưa có thì rỗng.
   */
  private loadCheckLinks(index: CellIndex): Promise<Map<string, CheckLink>> {
    void index;
    return Promise.resolve(new Map<string, CheckLink>());
  }

  /* ----------------------------------------------------------- gửi duyệt --- */

  async submit(actor: Reviewer, diagramId: string, input: SubmitInput): Promise<{ approval: ApprovalRecord; warnings: Finding[] }> {
    const reason = input.reason.trim();
    if (!reason) {
      throw new BadRequestException({ code: 'APPROVAL_REASON_REQUIRED', message: 'Ghi rõ lý do gửi duyệt — người duyệt cần biết bản này đổi gì.' });
    }
    if (textLooksLikeSecret(reason)) throw secretText('Lý do gửi duyệt');
    const version = await this.versionOf(diagramId, input.versionId);
    const result = await this.check(version.cellIndex);
    if (result.errors.length > 0) throw checkFailed(result, 'gửi duyệt');

    const approval = await this.db.transaction(async (tx) => {
      const diagram = await this.lockOfficialDiagram(tx, diagramId);
      if (diagram.officialVersionId === version.id) {
        throw new ConflictException({ code: 'DIAGRAM_ALREADY_OFFICIAL', message: 'Phiên bản này đã là bản chính thức.' });
      }
      /*
       * Một bản vẽ một yêu cầu chờ. Khoá ngoại duy nhất của `approval` chỉ chặn theo người gửi;
       * hàng `diagram` đang khoá FOR UPDATE nên hai lượt gửi cùng lúc xếp hàng qua câu kiểm này.
       */
      const open = await this.approvals.list({ kind: DIAGRAM_PUBLISH_KIND, subjectId: diagramId, state: 'pending' });
      if (open.length > 0) {
        throw new ConflictException({ code: 'DIAGRAM_REVIEW_PENDING', message: 'Bản vẽ này đang có một yêu cầu chờ duyệt.' });
      }
      const created = await this.approvals.createWithin(tx, {
        kind: DIAGRAM_PUBLISH_KIND,
        requester: actor.email,
        subjectType: 'diagram',
        subjectId: diagramId,
        reason,
        payload: { versionId: version.id, seq: version.seq, warnings: result.warnings.length },
      });
      await tx.insert(diagramHistoryTable).values({
        diagramId,
        action: 'review.submitted',
        actor: actor.email,
        changes: { approvalId: created.id, versionId: version.id, seq: version.seq, reason, warnings: result.warnings.length },
      });
      // Outbox chỉ mang id tham chiếu, không PII (AD-11/NFR-04).
      await this.outbox.enqueueWithin(tx, 'approval.requested', { approvalId: created.id });
      return created;
    });
    return { approval, warnings: result.warnings };
  }

  async withdraw(actor: Reviewer, diagramId: string, approvalId: string): Promise<ApprovalRecord> {
    const request = await this.requirePending(diagramId, approvalId);
    if (request.requester.toLowerCase() !== actor.email.toLowerCase()) {
      throw new ForbiddenException({ code: 'NOT_YOUR_REQUEST', message: 'Chỉ người gửi mới rút được yêu cầu này.' });
    }
    return this.db.transaction(async (tx) => {
      const done = await this.approvals.transitionWithin(tx, approvalId, { to: 'withdrawn', actor: actor.email });
      await tx.insert(diagramHistoryTable).values({ diagramId, action: 'review.withdrawn', actor: actor.email, changes: { approvalId } });
      return done;
    });
  }

  /* ---------------------------------------------------------------- duyệt --- */

  async approve(actor: Reviewer, diagramId: string, approvalId: string, note?: string | null): Promise<ApprovalRecord> {
    if (actor.role === 'member') throw managerOnly();
    const request = await this.requirePending(diagramId, approvalId);
    this.assertNotOwn(request, actor);
    if (note && textLooksLikeSecret(note)) throw secretText('Ghi chú duyệt');
    const versionId = payloadVersionId(request);
    return this.db.transaction(async (tx) => {
      // Chạy lại tự kiểm NGAY trong lượt duyệt: máy có thể vừa thanh lý sau khi gửi.
      await this.publishWithin(tx, actor.email, diagramId, versionId, { approvalId, action: 'duyệt' });
      const done = await this.approvals.transitionWithin(tx, approvalId, { to: 'approved', actor: actor.email, note: note ?? null });
      await this.outbox.enqueueWithin(tx, 'approval.decided', { approvalId, state: 'approved' });
      return done;
    });
  }

  /** Trả về: phải có ít nhất một ghi chú — ghim của lượt duyệt này, hoặc ghi chú chung. */
  async returnToSender(actor: Reviewer, diagramId: string, approvalId: string, input: { note?: string | null }): Promise<ApprovalRecord> {
    if (actor.role === 'member') throw managerOnly();
    const request = await this.requirePending(diagramId, approvalId);
    this.assertNotOwn(request, actor);
    const note = input.note?.trim() || null;
    if (note && textLooksLikeSecret(note)) throw secretText('Ghi chú trả về');
    const [pinned] = await this.db
      .select({ id: diagramCommentTable.id })
      .from(diagramCommentTable)
      .where(and(eq(diagramCommentTable.approvalId, approvalId), eq(diagramCommentTable.kind, 'note')))
      .limit(1);
    if (!pinned && !note) {
      throw new BadRequestException({
        code: 'DIAGRAM_RETURN_NOTE_REQUIRED',
        message: 'Ghim ít nhất một bình luận lên bản vẽ hoặc ghi chú chung trước khi trả về.',
      });
    }
    return this.db.transaction(async (tx) => {
      const done = await this.approvals.transitionWithin(tx, approvalId, { to: 'returned', actor: actor.email, note });
      await tx.insert(diagramHistoryTable).values({ diagramId, action: 'review.returned', actor: actor.email, changes: { approvalId, note } });
      await this.outbox.enqueueWithin(tx, 'approval.decided', { approvalId, state: 'returned' });
      return done;
    });
  }

  /* ------------------------------------------------------------- phát hành --- */

  /** Admin/SA tự phát hành (Q-23): lưu là nháp, bấm Phát hành mới thành chính thức; không qua duyệt. */
  async publish(actor: Reviewer, diagramId: string, input: { versionId?: string }): Promise<PublishResult> {
    if (actor.role === 'member') throw managerOnly();
    const version = await this.versionOf(diagramId, input.versionId);
    return this.db.transaction((tx) => this.publishWithin(tx, actor.email, diagramId, version.id, { approvalId: null, action: 'phát hành' }));
  }

  /**
   * Lùi bản chính thức một cú bấm: khôi phục phiên bản cũ thành phiên bản MỚI rồi phát hành nó,
   * cùng một transaction — không xoá lịch sử, không có phiên bản khôi phục nào bị bỏ dở.
   */
  async restoreOfficial(actor: Reviewer, diagramId: string, versionId: string): Promise<PublishResult> {
    if (actor.role === 'member') throw managerOnly();
    return this.db.transaction(async (tx) => {
      const restoredId = await this.diagrams.restoreWithin(tx, actor.email, diagramId, versionId);
      return this.publishWithin(tx, actor.email, diagramId, restoredId, { approvalId: null, action: 'khôi phục làm bản chính thức' });
    });
  }

  /** Phiên bản chính thức hiện tại + mọi phiên bản từng phát hành (để mở "khôi phục làm chính thức"). */
  async publications(diagramId: string): Promise<{ officialVersionId: string | null; publishedVersionIds: string[] }> {
    const [diagram] = await this.db.select({ official: diagramTable.officialVersionId }).from(diagramTable).where(eq(diagramTable.id, diagramId));
    if (!diagram) throw new NotFoundException({ code: 'DIAGRAM_NOT_FOUND', message: 'Không tìm thấy bản vẽ.' });
    const rows = await this.db
      .select({ changes: diagramHistoryTable.changes })
      .from(diagramHistoryTable)
      .where(and(eq(diagramHistoryTable.diagramId, diagramId), eq(diagramHistoryTable.action, 'version.published')));
    const ids = rows.map((r) => String((r.changes as { versionId?: string } | null)?.versionId ?? '')).filter(Boolean);
    return { officialVersionId: diagram.official, publishedVersionIds: [...new Set(ids)] };
  }

  private async publishWithin(
    tx: Tx,
    actor: string,
    diagramId: string,
    versionId: string,
    via: { approvalId: string | null; action: string },
  ): Promise<PublishResult> {
    const diagram = await this.lockOfficialDiagram(tx, diagramId);
    const [version] = await tx
      .select({ id: diagramVersionTable.id, seq: diagramVersionTable.seq, cellIndex: diagramVersionTable.cellIndex })
      .from(diagramVersionTable)
      .where(and(eq(diagramVersionTable.diagramId, diagramId), eq(diagramVersionTable.id, versionId)));
    if (!version) throw new NotFoundException({ code: 'DIAGRAM_VERSION_NOT_FOUND', message: 'Không tìm thấy phiên bản này của bản vẽ.' });
    if (diagram.officialVersionId === version.id) {
      throw new ConflictException({ code: 'DIAGRAM_ALREADY_OFFICIAL', message: 'Phiên bản này đã là bản chính thức.' });
    }
    const result = await this.check(version.cellIndex);
    if (result.errors.length > 0) throw checkFailed(result, via.action);
    await tx.update(diagramTable).set({ officialVersionId: version.id, updatedAt: new Date() }).where(eq(diagramTable.id, diagramId));
    const changes = {
      versionId: version.id,
      seq: version.seq,
      previousVersionId: diagram.officialVersionId,
      approvalId: via.approvalId,
      warnings: result.warnings.length,
    };
    await tx.insert(diagramHistoryTable).values({ diagramId, action: 'version.published', actor, changes });
    await this.audit.appendWithin(tx, { actor, action: 'diagram.published', objectType: 'diagram', objectId: diagramId, detail: changes });
    return { versionId: version.id, seq: version.seq, warnings: result.warnings };
  }

  /* --------------------------------------------------------- trang duyệt --- */

  async review(diagramId: string): Promise<ReviewPage> {
    const [diagram] = await this.db.select({ official: diagramTable.officialVersionId }).from(diagramTable).where(eq(diagramTable.id, diagramId));
    if (!diagram) throw new NotFoundException({ code: 'DIAGRAM_NOT_FOUND', message: 'Không tìm thấy bản vẽ.' });
    const [request] = await this.approvals.list({ kind: DIAGRAM_PUBLISH_KIND, subjectId: diagramId, state: 'pending' });
    const versionId = request ? payloadVersionId(request) : null;
    const [version] = versionId
      ? await this.db.select().from(diagramVersionTable).where(and(eq(diagramVersionTable.diagramId, diagramId), eq(diagramVersionTable.id, versionId)))
      : [];
    const [official] = diagram.official
      ? await this.db.select({ seq: diagramVersionTable.seq, cellIndex: diagramVersionTable.cellIndex }).from(diagramVersionTable).where(eq(diagramVersionTable.id, diagram.official))
      : [];
    if (!request || !version) {
      return { approval: null, versionId: null, seq: null, officialSeq: official?.seq ?? null, summary: null, errors: [], warnings: [], cells: [] };
    }
    const result = await this.check(version.cellIndex);
    const names = await this.users.namesByEmails([request.requester]);
    return {
      approval: { ...request, requesterName: names.get(request.requester) ?? request.requester },
      versionId: version.id,
      seq: version.seq,
      officialSeq: official?.seq ?? null,
      summary: summarizeDiff(diffCellIndex(official?.cellIndex ?? null, version.cellIndex)),
      errors: result.errors,
      warnings: result.warnings,
      cells: version.cellIndex.cells.map((c) => ({ id: c.id, kind: c.kind, label: c.ims.ims_device_code || c.label || c.id })),
    };
  }

  /* ------------------------------------------------------------ bình luận --- */

  async comments(diagramId: string): Promise<CommentThread[]> {
    const rows = await this.db
      .select()
      .from(diagramCommentTable)
      .where(eq(diagramCommentTable.diagramId, diagramId))
      .orderBy(asc(diagramCommentTable.createdAt), asc(diagramCommentTable.id));
    if (rows.length === 0) return [];
    const names = await this.users.namesByEmails([...new Set(rows.map((r) => r.author))]);
    const versionIds = [...new Set(rows.map((r) => r.versionId))];
    const seqs = new Map(
      (
        await this.db
          .select({ id: diagramVersionTable.id, seq: diagramVersionTable.seq })
          .from(diagramVersionTable)
          .where(inArray(diagramVersionTable.id, versionIds))
      ).map((v) => [v.id, v.seq]),
    );
    const toRow = (r: (typeof rows)[number]): CommentRow => ({
      id: r.id,
      versionId: r.versionId,
      approvalId: r.approvalId,
      parentId: r.parentId,
      kind: r.kind,
      cellId: r.cellId,
      anchor: r.anchor ?? null,
      body: r.body,
      author: r.author,
      authorName: names.get(r.author) ?? null,
      createdAt: r.createdAt.toISOString(),
    });
    const threads = new Map<string, CommentThread>();
    for (const r of rows) {
      if (r.parentId) continue;
      threads.set(r.id, { ...toRow(r), versionSeq: seqs.get(r.versionId) ?? null, resolved: false, replies: [] });
    }
    for (const r of rows) {
      const thread = r.parentId ? threads.get(r.parentId) : undefined;
      if (!thread) continue;
      // Sự kiện mới nhất quyết trạng thái luồng (rows đã xếp cũ trước).
      if (r.kind === 'resolved') thread.resolved = true;
      else if (r.kind === 'reopened') thread.resolved = false;
      else thread.replies.push(toRow(r));
    }
    return [...threads.values()].reverse();
  }

  /**
   * Ghim / ghi chú chung / trả lời. Ghim gốc gắn vào lượt duyệt đang chờ (nếu có) — trả về đếm
   * đúng những ghi chú này. Trả lời theo phiên bản + lượt duyệt của luồng gốc.
   */
  async addComment(actor: Reviewer, diagramId: string, input: CommentInput): Promise<CommentRow> {
    const body = input.body.trim();
    if (!body) throw new BadRequestException({ code: 'DIAGRAM_COMMENT_EMPTY', message: 'Bình luận không được trống.' });
    if (textLooksLikeSecret(body)) throw secretText('Bình luận');
    let versionId = input.versionId;
    let approvalId: string | null = null;
    let cellId = input.cellId ?? null;
    let anchor = input.anchor ?? null;
    const parentId = input.parentId ?? null;
    if (parentId) {
      const [root] = await this.db
        .select()
        .from(diagramCommentTable)
        .where(and(eq(diagramCommentTable.id, parentId), eq(diagramCommentTable.diagramId, diagramId), isNull(diagramCommentTable.parentId)));
      if (!root) throw new NotFoundException({ code: 'DIAGRAM_COMMENT_NOT_FOUND', message: 'Không tìm thấy luồng bình luận này.' });
      ({ versionId, approvalId, cellId } = root);
      anchor = null;
    } else {
      await this.versionOf(diagramId, versionId);
      const [pending] = await this.approvals.list({ kind: DIAGRAM_PUBLISH_KIND, subjectId: diagramId, state: 'pending' });
      approvalId = pending?.id ?? null;
    }
    const [row] = await this.db.transaction(async (tx) => {
      await this.lockOfficialDiagram(tx, diagramId);
      const inserted = await tx
        .insert(diagramCommentTable)
        .values({ diagramId, versionId, approvalId, parentId, kind: 'note', cellId, anchor, body, author: actor.email })
        .returning();
      // Nhật ký ghi id ô + độ dài, không chép lời bình (audit_log không xoá được).
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'diagram.commented',
        objectType: 'diagram',
        objectId: diagramId,
        detail: { commentId: inserted[0].id, parentId, cellId, approvalId, length: body.length },
      });
      return inserted;
    });
    const names = await this.users.namesByEmails([actor.email]);
    return {
      id: row.id,
      versionId: row.versionId,
      approvalId: row.approvalId,
      parentId: row.parentId,
      kind: row.kind,
      cellId: row.cellId,
      anchor: row.anchor ?? null,
      body: row.body,
      author: row.author,
      authorName: names.get(row.author) ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** "Đã xử lý" / "Mở lại" = một hàng sự kiện trỏ luồng gốc — nội dung luồng không bị sửa. */
  async resolveComment(actor: Reviewer, diagramId: string, commentId: string, resolved: boolean): Promise<void> {
    const [root] = await this.db
      .select({ id: diagramCommentTable.id, versionId: diagramCommentTable.versionId, approvalId: diagramCommentTable.approvalId, cellId: diagramCommentTable.cellId })
      .from(diagramCommentTable)
      .where(and(eq(diagramCommentTable.id, commentId), eq(diagramCommentTable.diagramId, diagramId), isNull(diagramCommentTable.parentId)));
    if (!root) throw new NotFoundException({ code: 'DIAGRAM_COMMENT_NOT_FOUND', message: 'Không tìm thấy luồng bình luận này.' });
    const kind: DiagramCommentKind = resolved ? 'resolved' : 'reopened';
    await this.db.transaction(async (tx) => {
      await this.lockOfficialDiagram(tx, diagramId);
      await tx.insert(diagramCommentTable).values({
        diagramId,
        versionId: root.versionId,
        approvalId: root.approvalId,
        parentId: root.id,
        kind,
        cellId: root.cellId,
        author: actor.email,
      });
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: resolved ? 'diagram.comment_resolved' : 'diagram.comment_reopened',
        objectType: 'diagram',
        objectId: diagramId,
        detail: { commentId: root.id },
      });
    });
  }

  /* ----------------------------------------------------------------- chung --- */

  /** Phiên bản theo id (thuộc đúng bản vẽ) hoặc mới nhất. */
  private async versionOf(diagramId: string, versionId?: string) {
    const conditions = [eq(diagramVersionTable.diagramId, diagramId)];
    if (versionId) conditions.push(eq(diagramVersionTable.id, versionId));
    const [row] = await this.db
      .select({ id: diagramVersionTable.id, seq: diagramVersionTable.seq, cellIndex: diagramVersionTable.cellIndex })
      .from(diagramVersionTable)
      .where(and(...conditions))
      .orderBy(desc(diagramVersionTable.seq))
      .limit(1);
    if (!row) {
      throw versionId
        ? new NotFoundException({ code: 'DIAGRAM_VERSION_NOT_FOUND', message: 'Không tìm thấy phiên bản này của bản vẽ.' })
        : new BadRequestException({ code: 'DIAGRAM_NO_VERSION', message: 'Bản vẽ chưa lưu lần nào — lưu trước rồi mới gửi duyệt/phát hành.' });
    }
    return row;
  }

  /**
   * Khoá hàng `diagram` trong `tx`: các lượt gửi/duyệt/phát hành cùng lúc trên một bản vẽ xếp
   * hàng. Bản đã lưu trữ hay bản trình bày (không duyệt — Q-23) bị từ chối.
   */
  private async lockOfficialDiagram(tx: Tx, diagramId: string) {
    const [row] = await tx
      .select({ archivedAt: diagramTable.archivedAt, kind: diagramTable.kind, officialVersionId: diagramTable.officialVersionId })
      .from(diagramTable)
      .where(eq(diagramTable.id, diagramId))
      .for('update');
    if (!row) throw new NotFoundException({ code: 'DIAGRAM_NOT_FOUND', message: 'Không tìm thấy bản vẽ.' });
    if (row.archivedAt) throw new ConflictException({ code: 'DIAGRAM_ARCHIVED', message: 'Bản vẽ đã lưu trữ — không sửa được nữa.' });
    if (row.kind !== 'official') {
      throw new ConflictException({ code: 'DIAGRAM_NOT_REVIEWABLE', message: 'Bản trình bày không qua duyệt, không phát hành.' });
    }
    return row;
  }

  private async requirePending(diagramId: string, approvalId: string): Promise<ApprovalRecord> {
    const request = await this.approvals.findOne(approvalId).catch((error: unknown) => {
      if (error instanceof NotFoundException) throw notFound();
      throw error;
    });
    // Yêu cầu loại khác hay của bản vẽ khác trả CÙNG lỗi với "không có": đoán id không lộ gì.
    if (request.kind !== DIAGRAM_PUBLISH_KIND || request.subjectId !== diagramId) throw notFound();
    if (request.state !== 'pending') {
      throw new ConflictException({ code: 'APPROVAL_ALREADY_DECIDED', message: 'Yêu cầu này đã được xử lý. Tải lại để xem quyết định.' });
    }
    return request;
  }

  /** Bốn mắt: người gửi không tự duyệt/trả về bản mình gửi — Admin tự vẽ thì đi đường Phát hành. */
  private assertNotOwn(request: ApprovalRecord, actor: Reviewer): void {
    if (request.requester.toLowerCase() === actor.email.toLowerCase()) {
      throw new ForbiddenException({
        code: 'CANNOT_APPROVE_OWN_REQUEST',
        message: 'Không tự duyệt bản do chính mình gửi được. Rút yêu cầu rồi bấm Phát hành, hoặc nhờ Admin khác.',
      });
    }
  }
}

/** Cùng mã + câu với cổng DTO `@NoSecretText` (Q-19, FR-035): một luật, một câu. */
function secretText(label: string): BadRequestException {
  return new BadRequestException({ code: 'NOTE_LOOKS_LIKE_SECRET', message: secretTextMessage(label) });
}
