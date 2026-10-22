import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Tx } from '../../common/tx';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { ApprovalsApiService } from '../approvals/approvals.api';
import { AuditWriterService } from '../audit/audit-writer.service';
import type { UserRole } from '../auth/types';
import { collectUnusedImagesWithin } from './diagram-images';
import { planCollapse, planDraftDiscard, seqRanges, type CollapsePlan, type DraftPlan, type PruneVersion } from './diagram-prune';
import { canManageNode } from './diagram-presentation';
import { diagramDriftTable, diagramHistoryTable, diagramPresenceTable, diagramTable, diagramVersionTable } from './diagram.schema';
import { DiagramsService } from './diagrams.service';

/** Cùng mã với `DIAGRAM_PUBLISH_KIND` của `diagram-review.service.ts` — không import để tránh vòng phụ thuộc. */
const PUBLISH_KIND = 'diagram_publish';

export interface PruneActor {
  email: string;
  role: UserRole;
}

export interface DraftPreview {
  /** Số lần lưu sẽ xoá. */
  count: number;
  /** "#13–#17" — để hộp xác nhận và dòng lịch sử nói cùng một câu. */
  ranges: string;
  /** Mốc giữ (bản chính thức, hoặc phiên bản đầu). */
  keepSeq: number | null;
  /** Bản nháp vẫn giữ vì đã đặt tên / bị bản giữ lại trỏ tới. */
  keptDrafts: number;
  /** Yêu cầu chờ duyệt trỏ vào một bản sẽ xoá — phải rút trước. */
  blockedByApprovalId: string | null;
}

/**
 * "Bỏ bản nháp", "Xoá hẳn" và "Xóa vĩnh viễn" (Q-23). Mọi lượt xoá đi qua `diagram_delete_versions` (0056, 0058) trong
 * CÙNG transaction với dòng lịch sử + nhật ký (AD-5), sau khi khoá hàng `diagram` FOR UPDATE —
 * lưu, gửi duyệt, phát hành cùng lúc xếp hàng sau nó và thấy kết quả đã xoá.
 */
@Injectable()
export class DiagramPruneService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly approvals: ApprovalsApiService,
    private readonly diagrams: DiagramsService,
  ) {}

  /** Xem trước "Chỉ giữ bản này" (Q-26 07/10): xoá bao nhiêu lần lưu, bản gộp sẽ mang số mấy. */
  async collapsePreview(actor: PruneActor, diagramId: string, versionId: string): Promise<DraftPreview & { nextSeq: number }> {
    return this.db.transaction(async (tx) => {
      const diagram = await this.lock(tx, diagramId, false);
      assertCanDiscard(diagram, actor);
      const plan = planCollapse(await this.versionsOf(tx, diagramId), diagram.officialVersionId, versionId);
      if (plan.refused) throw collapseRefused(plan.refused);
      return { ...(await this.preview(diagramId, { keepSeq: null, discard: plan.discard, keptDrafts: 0 })), nextSeq: plan.nextSeq };
    });
  }

  /**
   * "Chỉ giữ bản này" (Q-26 07/10): xoá mọi bản nháp (cùng loại trừ như "Bỏ bản nháp") rồi ghi nội dung
   * bản được chọn thành MỘT lần lưu mới — không còn bản nào giữ lại thì nó là #1. Nội dung đọc trước khi
   * xoá, cùng transaction; ảnh nhúng nối lại vào bản mới trước khi dọn ảnh mồ côi. `expectRanges` như
   * `discardDrafts`: có người lưu thêm giữa lúc hộp xác nhận mở thì 409.
   */
  async collapseDrafts(actor: PruneActor, diagramId: string, versionId: string, expectRanges?: string): Promise<{ id: string; seq: number; count: number; ranges: string }> {
    return this.db.transaction(async (tx) => {
      const diagram = await this.lock(tx, diagramId, true);
      assertCanDiscard(diagram, actor);
      if (diagram.archivedAt) throw archived();
      const plan = planCollapse(await this.versionsOf(tx, diagramId), diagram.officialVersionId, versionId);
      if (plan.refused) throw collapseRefused(plan.refused);
      const preview = await this.preview(diagramId, { keepSeq: null, discard: plan.discard, keptDrafts: 0 });
      if (expectRanges !== undefined && expectRanges !== preview.ranges) {
        throw new ConflictException({
          code: 'DIAGRAM_DRAFTS_CHANGED',
          message: `Bản vẽ vừa có thay đổi: nay sẽ gộp ${preview.count} lần lưu ${preview.ranges}. Bấm "Chỉ giữ bản này" lại để xác nhận số mới.`,
        });
      }
      if (preview.blockedByApprovalId) {
        throw new ConflictException({
          code: 'DIAGRAM_DISCARD_PENDING',
          message: 'Có yêu cầu phát hành đang chờ duyệt trỏ vào một bản nháp sẽ gộp — người gửi rút yêu cầu trước.',
        });
      }
      const [source] = await tx
        .select()
        .from(diagramVersionTable)
        .where(and(eq(diagramVersionTable.diagramId, diagramId), eq(diagramVersionTable.id, versionId)));
      const count = await deleteVersions(tx, diagramId, plan.discard.map((v) => v.id), 'drafts');
      const id = await this.diagrams.insertCollapsedWithin(tx, actor.email, diagramId, source, plan.nextSeq);
      await collectUnusedImagesWithin(tx);
      await this.record(tx, actor.email, diagramId, 'versions.collapsed', 'diagram.drafts_collapsed', {
        count,
        ranges: preview.ranges,
        seqs: plan.discard.map((v) => v.seq),
        keptSeq: source.seq,
        newSeq: plan.nextSeq,
      });
      return { id, seq: plan.nextSeq, count, ranges: preview.ranges };
    });
  }

  /** `fromSeq` = chỉ xem trước dải từ số đó trở về sau (panel tick một bản nháp); thiếu = mọi bản nháp. */
  async draftPreview(actor: PruneActor, diagramId: string, fromSeq?: number): Promise<DraftPreview> {
    return this.db.transaction(async (tx) => {
      const diagram = await this.lock(tx, diagramId, false);
      assertCanDiscard(diagram, actor);
      const plan = await this.plan(tx, diagramId, diagram.officialVersionId, fromSeq);
      return this.preview(diagramId, plan);
    });
  }

  /**
   * `expectRanges` = dải người dùng đã thấy trong hộp xác nhận. Có người lưu thêm giữa lúc hộp mở
   * thì dải đổi: từ chối (409) thay vì xoá luôn lần lưu người bấm chưa hề thấy. `fromSeq` như
   * `draftPreview` — dải chỉ là ĐUÔI từ số đó, không bao giờ một bản lẻ ở giữa (Q-23).
   */
  async discardDrafts(actor: PruneActor, diagramId: string, expectRanges?: string, fromSeq?: number): Promise<{ count: number; ranges: string }> {
    return this.db.transaction(async (tx) => {
      const diagram = await this.lock(tx, diagramId, true);
      assertCanDiscard(diagram, actor);
      if (diagram.archivedAt) throw archived();
      const plan = await this.plan(tx, diagramId, diagram.officialVersionId, fromSeq);
      const preview = await this.preview(diagramId, plan);
      if (preview.count === 0) {
        throw new ConflictException({ code: 'DIAGRAM_NO_DRAFTS', message: 'Không có bản nháp nào để bỏ — các lần lưu sau mốc giữ đều đã đặt tên hoặc từng phát hành.' });
      }
      if (expectRanges !== undefined && expectRanges !== preview.ranges) {
        throw new ConflictException({
          code: 'DIAGRAM_DRAFTS_CHANGED',
          message: `Bản vẽ vừa có thay đổi: nay sẽ bỏ ${preview.count} lần lưu ${preview.ranges}. Bấm "Bỏ bản nháp" lại để xác nhận số mới.`,
        });
      }
      if (preview.blockedByApprovalId) {
        throw new ConflictException({
          code: 'DIAGRAM_DISCARD_PENDING',
          message: 'Có yêu cầu phát hành đang chờ duyệt trỏ vào một bản nháp sẽ bỏ — người gửi rút yêu cầu trước, rồi bỏ bản nháp.',
        });
      }
      const deleted = await deleteVersions(tx, diagramId, plan.discard.map((v) => v.id), 'drafts');
      await collectUnusedImagesWithin(tx);
      const changes = {
        count: deleted,
        ranges: preview.ranges,
        seqs: plan.discard.map((v) => v.seq),
        keepSeq: plan.keepSeq,
        ...(fromSeq === undefined ? {} : { fromSeq }),
      };
      await this.record(tx, actor.email, diagramId, 'versions.discarded', 'diagram.drafts_discarded', changes);
      return { count: deleted, ranges: preview.ranges };
    });
  }

  /**
   * "Xoá hẳn" bản vẽ CHƯA phát hành lần nào: hàng `diagram` thành bia mộ (lịch sử chỉ-thêm trỏ vào
   * nó), mọi phiên bản + tên + bình luận đi qua hàm xoá chế độ `purge`. `confirmName` = tên người
   * dùng gõ lại — server kiểm, không tin hộp xác nhận của web.
   */
  async purge(actor: PruneActor, diagramId: string, confirmName: string): Promise<{ versions: number }> {
    return this.db.transaction(async (tx) => {
      const diagram = await this.lock(tx, diagramId, true);
      const creator = diagram.createdBy.toLowerCase() === actor.email.toLowerCase();
      if (!creator && !canManageNode(diagram, actor)) {
        throw new ForbiddenException({ code: 'DIAGRAM_MANAGE_FORBIDDEN', message: 'Chỉ Super Admin / Quản trị hoặc người tạo bản vẽ này mới xóa hẳn được.' });
      }
      if (confirmName.trim() !== diagram.name.trim()) {
        throw new BadRequestException({ code: 'DIAGRAM_CONFIRM_NAME', message: 'Tên gõ lại không khớp tên bản vẽ.' });
      }
      const published = await tx
        .select({ id: diagramHistoryTable.id })
        .from(diagramHistoryTable)
        .where(and(eq(diagramHistoryTable.diagramId, diagramId), eq(diagramHistoryTable.action, 'version.published')))
        .limit(1);
      if (diagram.officialVersionId || published.length > 0) {
        throw new ConflictException({
          code: 'DIAGRAM_PUBLISHED',
          message: 'Bản vẽ đã từng phát hành là hồ sơ — không xóa hẳn được. Dùng "Lưu trữ", hoặc "Bỏ bản nháp" để dọn các lần lưu dở.',
        });
      }
      const [child] = await tx
        .select({ id: diagramTable.id })
        .from(diagramTable)
        .where(and(or(eq(diagramTable.parentId, diagramId), eq(diagramTable.sourceDiagramId, diagramId)), isNull(diagramTable.deletedAt)))
        .limit(1);
      if (child) {
        throw new ConflictException({ code: 'DIAGRAM_HAS_CHILDREN', message: 'Bản vẽ còn bản vẽ con (kể cả đã lưu trữ) — xóa hoặc chuyển chúng trước.' });
      }
      const pending = await this.approvals.list({ kind: PUBLISH_KIND, subjectId: diagramId, state: 'pending' });
      if (pending.length > 0) {
        throw new ConflictException({ code: 'DIAGRAM_REVIEW_PENDING', message: 'Bản vẽ đang có yêu cầu chờ duyệt — rút yêu cầu trước rồi mới xóa.' });
      }
      const now = new Date();
      await tx
        .update(diagramTable)
        .set({ deletedAt: now, deletedBy: actor.email, archivedAt: diagram.archivedAt ?? now, archivedBy: diagram.archivedBy ?? actor.email, updatedAt: now })
        .where(eq(diagramTable.id, diagramId));
      const { rows } = await tx.execute<{ id: string }>(sql`SELECT id FROM diagram_version WHERE diagram_id = ${diagramId}`);
      const versions = await deleteVersions(tx, diagramId, rows.map((r) => r.id), 'purge');
      await tx.delete(diagramPresenceTable).where(eq(diagramPresenceTable.diagramId, diagramId));
      await tx.delete(diagramDriftTable).where(eq(diagramDriftTable.diagramId, diagramId));
      await collectUnusedImagesWithin(tx);
      await this.record(tx, actor.email, diagramId, 'deleted', 'diagram.deleted', { name: diagram.name, versions });
      return { versions };
    });
  }

  /**
   * "Xóa vĩnh viễn" bản vẽ ĐÃ LƯU TRỮ, kể cả bản từng phát hành (Q-23): chỉ Admin/SA, gõ đúng
   * tên. Bản vẽ phải được lưu trữ từ một lượt trước — DB (0058, mốc do 0061 đóng dấu) cũng từ chối
   * bản vừa lưu trữ trong chính lượt này. Còn bản vẽ con chưa xoá vĩnh viễn (kể cả con đã lưu trữ)
   * thì chặn: con treo dưới một bia mộ thì không bao giờ bỏ lưu trữ được.
   */
  async erase(actor: PruneActor, diagramId: string, confirmName: string): Promise<{ versions: number }> {
    if (actor.role !== 'sa' && actor.role !== 'admin') {
      throw new ForbiddenException({ code: 'DIAGRAM_MANAGE_FORBIDDEN', message: 'Chỉ Super Admin / Quản trị mới xóa vĩnh viễn bản vẽ đã lưu trữ được.' });
    }
    return this.db.transaction(async (tx) => {
      const diagram = await this.lock(tx, diagramId, true);
      if (!diagram.archivedAt) {
        throw new ConflictException({ code: 'DIAGRAM_NOT_ARCHIVED', message: 'Chỉ xóa vĩnh viễn được bản vẽ đã lưu trữ — lưu trữ bản vẽ trước.' });
      }
      if (confirmName.trim() !== diagram.name.trim()) {
        throw new BadRequestException({ code: 'DIAGRAM_CONFIRM_NAME', message: 'Tên gõ lại không khớp tên bản vẽ.' });
      }
      const children = await tx
        .select({ name: diagramTable.name })
        .from(diagramTable)
        .where(and(eq(diagramTable.parentId, diagramId), isNull(diagramTable.deletedAt)))
        .orderBy(diagramTable.name);
      if (children.length > 0) {
        // Bản cha chỉ lưu trữ được khi mọi con đã lưu trữ, nên con nằm ở khu "Đã lưu trữ" — không
        // hiện trên bản đồ; câu báo chỉ đường, không thì người xoá đi tìm mãi.
        throw new ConflictException({
          code: 'DIAGRAM_HAS_CHILDREN',
          message:
            `Bản vẽ còn ${children.length} bản vẽ con chưa xóa vĩnh viễn: ${children.map((c) => `"${c.name}"`).join(', ')}. ` +
            'Mở khu "Đã lưu trữ" của /diagrams, xóa vĩnh viễn từng bản vẽ con trước rồi mới xóa được bản này.',
        });
      }
      const pending = await this.approvals.list({ kind: PUBLISH_KIND, subjectId: diagramId, state: 'pending' });
      if (pending.length > 0) {
        throw new ConflictException({ code: 'DIAGRAM_REVIEW_PENDING', message: 'Bản vẽ đang có yêu cầu chờ duyệt — từ chối hoặc rút yêu cầu trước rồi mới xóa.' });
      }
      const published = await tx
        .select({ id: diagramHistoryTable.id })
        .from(diagramHistoryTable)
        .where(and(eq(diagramHistoryTable.diagramId, diagramId), eq(diagramHistoryTable.action, 'version.published')))
        .limit(1);
      const now = new Date();
      // Bỏ trỏ bản chính thức trước: khoá ngoại vào phiên bản, và bia mộ không có bản chính thức.
      await tx
        .update(diagramTable)
        .set({ officialVersionId: null, deletedAt: now, deletedBy: actor.email, updatedAt: now })
        .where(eq(diagramTable.id, diagramId));
      const { rows } = await tx.execute<{ id: string }>(sql`SELECT id FROM diagram_version WHERE diagram_id = ${diagramId}`);
      const versions = await deleteVersions(tx, diagramId, rows.map((r) => r.id), 'erase');
      await tx.delete(diagramPresenceTable).where(eq(diagramPresenceTable.diagramId, diagramId));
      await tx.delete(diagramDriftTable).where(eq(diagramDriftTable.diagramId, diagramId));
      await collectUnusedImagesWithin(tx);
      await this.record(tx, actor.email, diagramId, 'erased', 'diagram.erased', {
        name: diagram.name,
        versions,
        published: Boolean(diagram.officialVersionId) || published.length > 0,
      });
      return { versions };
    });
  }

  private async lock(tx: Tx, diagramId: string, forUpdate: boolean) {
    const query = tx
      .select({
        name: diagramTable.name,
        kind: diagramTable.kind,
        ownerEmail: diagramTable.ownerEmail,
        createdBy: diagramTable.createdBy,
        archivedAt: diagramTable.archivedAt,
        archivedBy: diagramTable.archivedBy,
        officialVersionId: diagramTable.officialVersionId,
      })
      .from(diagramTable)
      .where(and(eq(diagramTable.id, diagramId), isNull(diagramTable.deletedAt)));
    const [row] = forUpdate ? await query.for('update') : await query;
    if (!row) throw new NotFoundException({ code: 'DIAGRAM_NOT_FOUND', message: 'Không tìm thấy bản vẽ.' });
    return row;
  }

  private async plan(tx: Tx, diagramId: string, officialVersionId: string | null, fromSeq?: number): Promise<DraftPlan> {
    const plan = planDraftDiscard(await this.versionsOf(tx, diagramId), officialVersionId, fromSeq);
    if (plan.fromInvalid) {
      throw new BadRequestException({
        code: 'DIAGRAM_DRAFT_FROM_INVALID',
        message: `Chỉ bỏ được bản nháp SAU bản ${plan.keepSeq === null ? 'giữ lại' : `#${plan.keepSeq}`} — chọn lại bản nháp bắt đầu.`,
      });
    }
    return plan;
  }

  private async versionsOf(tx: Tx, diagramId: string): Promise<PruneVersion[]> {
    const { rows } = await tx.execute<{
      id: string;
      seq: number;
      based_on_version_id: string | null;
      restored_from_version_id: string | null;
      named: boolean;
      published: boolean;
    }>(sql`
      SELECT v.id, v.seq, v.based_on_version_id, v.restored_from_version_id,
             COALESCE((SELECT l.label IS NOT NULL FROM diagram_version_label l
                        WHERE l.version_id = v.id ORDER BY l.created_at DESC, l.id DESC LIMIT 1), false) AS named,
             EXISTS (SELECT 1 FROM diagram_history h
                      WHERE h.diagram_id = v.diagram_id AND h.action = 'version.published'
                        AND h.changes ->> 'versionId' = v.id::text) AS published
        FROM diagram_version v
       WHERE v.diagram_id = ${diagramId}
    `);
    return rows.map((r) => ({
      id: r.id,
      seq: Number(r.seq),
      basedOnVersionId: r.based_on_version_id,
      restoredFromVersionId: r.restored_from_version_id,
      named: r.named,
      published: r.published,
    }));
  }

  private async preview(diagramId: string, plan: DraftPlan): Promise<DraftPreview> {
    const doomed = new Set(plan.discard.map((v) => v.id));
    const pending = doomed.size === 0 ? [] : await this.approvals.list({ kind: PUBLISH_KIND, subjectId: diagramId, state: 'pending' });
    const blocking = pending.find((a) => {
      const versionId = a.payload?.versionId;
      return typeof versionId === 'string' && doomed.has(versionId);
    });
    return {
      count: plan.discard.length,
      ranges: seqRanges(plan.discard.map((v) => v.seq)),
      keepSeq: plan.keepSeq,
      keptDrafts: plan.keptDrafts,
      blockedByApprovalId: blocking?.id ?? null,
    };
  }

  private async record(tx: Tx, actor: string, diagramId: string, action: string, auditAction: string, changes: Record<string, unknown>): Promise<void> {
    await tx.insert(diagramHistoryTable).values({ diagramId, action, actor, changes });
    await this.audit.appendWithin(tx, { actor, action: auditAction, objectType: 'diagram', objectId: diagramId, detail: changes });
  }
}

async function deleteVersions(tx: Tx, diagramId: string, ids: string[], mode: 'drafts' | 'purge' | 'erase'): Promise<number> {
  if (ids.length === 0) return 0;
  const { rows } = await tx.execute<{ n: number }>(
    sql`SELECT diagram_delete_versions(${diagramId}::uuid, ${`{${ids.join(',')}}`}::uuid[], ${mode}) AS n`,
  );
  return Number(rows[0].n);
}

function collapseRefused(reason: NonNullable<CollapsePlan['refused']>): HttpException {
  const message = {
    missing: 'Không tìm thấy phiên bản này của bản vẽ.',
    'not-draft': 'Bản này đã đặt tên, từng phát hành hoặc là bản chính thức — vốn đã được giữ, không cần gộp.',
    pinned: 'Bản này là gốc của một bản đã đặt tên / phát hành — không gộp được; chọn bản nháp mới hơn.',
    alone: 'Bản này đã là bản nháp duy nhất — không có gì để gộp.',
  }[reason];
  return reason === 'missing'
    ? new NotFoundException({ code: 'DIAGRAM_VERSION_NOT_FOUND', message })
    : new ConflictException({ code: 'DIAGRAM_COLLAPSE_REFUSED', message });
}

function assertCanDiscard(diagram: { kind: 'official' | 'presentation'; ownerEmail: string | null; createdBy: string }, actor: PruneActor): void {
  if (!canManageNode(diagram, actor)) {
    throw new ForbiddenException({
      code: 'DIAGRAM_MANAGE_FORBIDDEN',
      message: 'Thành viên chỉ bỏ bản nháp của bản trình bày do mình tạo hoặc phụ trách — bản chính thức cần Super Admin / Quản trị.',
    });
  }
}

function archived(): ConflictException {
  return new ConflictException({ code: 'DIAGRAM_ARCHIVED', message: 'Bản vẽ đã lưu trữ — không sửa được nữa.' });
}
