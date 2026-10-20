import { ConflictException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE_DB, type Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { EnvelopeCryptoService } from '../../common/crypto/envelope.service';
import { ApprovalKindRegistry } from '../../common/approvals/approvals-registry';
import { MailContentRegistry, type MailContent } from '../../common/mail-content.registry';
import { UI_PATHS } from '../../common/ui-paths';
import { AuditWriterService } from '../audit/audit-writer.service';
import { ApprovalsApiService } from '../approvals/approvals.api';
import { SystemConfigService } from '../config-sys/system-config.service';
import { OutboxService } from '../outbox/outbox.service';
import { UsersApiService } from '../users/users.api';
import {
  CODE_KEY_INFO,
  CODE_MAX_FAILED,
  CODE_MAX_SENDS,
  CODE_TTL_MS,
  codeHash,
  generateCode,
  judgeCode,
  type CodeVerdict,
} from './break-glass-code';
import { breakGlassCodeTable } from './vault.schema';

/**
 * Topic outbox của thư mang mã. Payload chỉ có id + số lượt gửi (NFR-04), không bao giờ có mã.
 * Lời gọi `enqueueWithin` viết chữ thẳng (không qua hằng này) để `mail-topics.spec.ts` quét được.
 */
export const BREAK_GLASS_CODE_TOPIC = 'break_glass.code';

const BREAK_GLASS_KIND = 'break_glass';

/** Trạng thái mã của một yêu cầu như người xin cần thấy — không có hash. */
export interface CodeStatus {
  approver: string;
  /** Còn bao nhiêu lần "Gửi lại mã". */
  resendsLeft: number;
  attemptsLeft: number;
  /** Mã hiện hành còn bao nhiêu giây; `null` khi thư chưa đi (hoặc mã vừa bị thay). */
  codeSecondsLeft: number | null;
}

export interface CodeAttempt {
  verdict: CodeVerdict;
  attemptsLeft: number;
  approver: string;
}

/**
 * Mã duyệt "Xin mở két" (Q-30): chủ bảng `break_glass_code` (AD-3).
 *
 * Mã SINH lúc worker dựng thư, không phải lúc người xin bấm gửi: chỉ cách đó mới vừa lưu được duy
 * nhất HMAC trong DB vừa đưa được mã rõ vào thư, mà outbox không phải chở mã (NFR-04). Hệ quả có
 * chủ ý: 10 phút tính từ lúc thư được dựng, nên hàng đợi dồn không ăn mất hạn của người duyệt.
 */
@Injectable()
export class BreakGlassCodeService implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly crypto: EnvelopeCryptoService,
    private readonly audit: AuditWriterService,
    private readonly outbox: OutboxService,
    private readonly approvals: ApprovalsApiService,
    private readonly kinds: ApprovalKindRegistry,
    private readonly users: UsersApiService,
    private readonly contents: MailContentRegistry,
    private readonly config: SystemConfigService,
  ) {}

  onModuleInit(): void {
    this.contents.register(BREAK_GLASS_CODE_TOPIC, (payload) => this.codeMail(payload));
    /*
     * Thư chung "có yêu cầu cần duyệt" và thư nhắc theo giờ của `approvals` không gửi cho mở két
     * nữa: người duyệt đã nhận thư mã, và người xin tự bấm "Gửi lại mã" khi cần.
     */
    this.contents.register(`approval:${BREAK_GLASS_KIND}`, () => Promise.resolve(null));
  }

  /** Khoá HMAC đọc lại mỗi lần: xoay master key thì mã đang sống mất hiệu lực, không giữ khoá cũ. */
  private key(): Buffer {
    return this.crypto.deriveKey(CODE_KEY_INFO);
  }

  /** Mở hàng mã cho yêu cầu vừa tạo + đẩy thư lượt 1, cùng transaction với yêu cầu (AD-5). */
  async openWithin(tx: Tx, approvalId: string, approver: string): Promise<void> {
    await tx.insert(breakGlassCodeTable).values({ approvalId, approver });
    await this.outbox.enqueueWithin(tx, 'break_glass.code', { approvalId, sendNo: 1 });
  }

  /**
   * "Gửi lại mã": huỷ mã hiện hành ngay (không chờ thư mới tới) rồi đẩy lượt gửi kế. Khoá hàng để
   * hai cú bấm cùng lúc không cùng vượt trần.
   */
  async resendWithin(tx: Tx, approvalId: string, actor: string): Promise<CodeStatus> {
    const row = await this.lockWithin(tx, approvalId);
    if (row.sendNo >= CODE_MAX_SENDS) {
      throw new ConflictException({
        code: 'BREAK_GLASS_CODE_RESEND_LIMIT',
        message: `Đã gửi lại mã ${CODE_MAX_SENDS - 1} lần. Rút yêu cầu này và gửi yêu cầu mới nếu vẫn cần.`,
      });
    }
    const sendNo = row.sendNo + 1;
    await tx
      .update(breakGlassCodeTable)
      .set({ sendNo, codeHash: null, codeExpiresAt: null, updatedAt: new Date() })
      .where(eq(breakGlassCodeTable.approvalId, approvalId));
    await this.outbox.enqueueWithin(tx, 'break_glass.code', { approvalId, sendNo });
    await this.audit.appendWithin(tx, {
      actor,
      action: 'break_glass.code_resent',
      objectType: 'approval',
      objectId: approvalId,
      detail: { sendNo, approver: row.approver },
    });
    return toStatus({ ...row, sendNo, codeExpiresAt: null }, new Date());
  }

  /**
   * Một lượt nhập mã. Ghi số lượt sai, và mã đúng thì xoá hash ngay (dùng một lần) — trong `tx`
   * của nơi gọi, để lượt duyệt và lượt đốt mã cùng commit hoặc cùng rollback.
   */
  async attemptWithin(tx: Tx, approvalId: string, typed: string, actor: string): Promise<CodeAttempt> {
    const row = await this.lockWithin(tx, approvalId);
    const judged = judgeCode(this.key(), approvalId, typed, row, new Date());
    if (judged.verdict === 'ok') {
      await tx
        .update(breakGlassCodeTable)
        .set({ codeHash: null, codeExpiresAt: null, updatedAt: new Date() })
        .where(eq(breakGlassCodeTable.approvalId, approvalId));
    } else if (judged.failedAttempts !== row.failedAttempts) {
      await tx
        .update(breakGlassCodeTable)
        .set({ failedAttempts: judged.failedAttempts, updatedAt: new Date() })
        .where(eq(breakGlassCodeTable.approvalId, approvalId));
      await this.audit.appendWithin(tx, {
        actor,
        action: 'break_glass.code_failed',
        objectType: 'approval',
        objectId: approvalId,
        detail: { failedAttempts: judged.failedAttempts },
      });
    }
    return {
      verdict: judged.verdict,
      attemptsLeft: Math.max(0, CODE_MAX_FAILED - judged.failedAttempts),
      approver: row.approver,
    };
  }

  /** Trạng thái mã của nhiều yêu cầu một lượt — badge, hàng chờ, verdict. */
  async statusOf(approvalIds: string[]): Promise<Map<string, CodeStatus>> {
    if (approvalIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(breakGlassCodeTable)
      .where(inArray(breakGlassCodeTable.approvalId, approvalIds));
    const now = new Date();
    return new Map(rows.map((row) => [row.approvalId, toStatus(row, now)]));
  }

  private async lockWithin(tx: Tx, approvalId: string) {
    const rows = await tx
      .select()
      .from(breakGlassCodeTable)
      .where(eq(breakGlassCodeTable.approvalId, approvalId))
      .for('update');
    if (!rows[0]) {
      // Yêu cầu tạo trước Q-30 không có hàng mã: không có đường duyệt bằng mã cho nó.
      throw new ConflictException({
        code: 'BREAK_GLASS_CODE_MISSING',
        message: 'Yêu cầu này gửi trước khi đổi sang duyệt bằng mã. Rút yêu cầu và gửi lại.',
      });
    }
    return rows[0];
  }

  /**
   * Dựng thư mang mã (chạy trong worker). Lượt gửi đã bị thay, yêu cầu không còn chờ → `null`.
   *
   * Sinh mã và ghi hash TRƯỚC khi thư đi: gửi lỗi thì lượt thử lại sinh mã mới thay mã cũ, nên
   * không bao giờ có một mã đang sống mà không ai nhận được.
   */
  private async codeMail(payload: Record<string, unknown>): Promise<MailContent | null> {
    const approvalId = typeof payload.approvalId === 'string' ? payload.approvalId : null;
    const sendNo = Number(payload.sendNo);
    if (!approvalId || !Number.isInteger(sendNo)) return null;
    const request = await this.approvals.findOne(approvalId).catch((error: unknown) => {
      if (error instanceof NotFoundException) return null;
      throw error;
    });
    if (!request || request.kind !== BREAK_GLASS_KIND || request.state !== 'pending') return null;

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    const updated = await this.db
      .update(breakGlassCodeTable)
      .set({ codeHash: codeHash(this.key(), approvalId, code), codeExpiresAt: expiresAt, updatedAt: new Date() })
      .where(
        and(
          eq(breakGlassCodeTable.approvalId, approvalId),
          eq(breakGlassCodeTable.sendNo, sendNo),
          sql`${breakGlassCodeTable.failedAttempts} < ${CODE_MAX_FAILED}`,
        ),
      )
      .returning({ approver: breakGlassCodeTable.approver });
    if (!updated[0]) return null;

    const [names, subject, timeZone] = await Promise.all([
      this.users.namesByEmails([request.requester]),
      this.kinds.describe(request.kind, request.subjectType, request.subjectId),
      this.config.getString('appTimezone'),
    ]);
    const who = names.get(request.requester.toLowerCase()) ?? request.requester;
    const at = (date: Date) => date.toLocaleString('vi-VN', { timeZone });
    const hours = Number((request.payload as { hours?: unknown } | null)?.hours);
    const asked = Number.isFinite(hours) && hours > 0 ? `${hours} giờ` : 'Không ghi số giờ';
    return {
      to: [updated[0].approver],
      // Không có mã trong tiêu đề: tiêu đề hiện trên màn khoá điện thoại.
      subject: `[IMS] Mã duyệt mở két: ${who}${subject ? ` · ${subject.code}` : ''} (${asked})`,
      title: sendNo > 1 ? 'Mã duyệt mở két (gửi lại)' : 'Mã duyệt mở két',
      intro:
        `${who} xin mở két và chọn bạn duyệt. Đồng ý thì đọc mã dưới đây cho người xin ` +
        '(gọi điện hoặc gặp trực tiếp). Không đồng ý thì không báo mã.',
      rows: [
        { label: 'Mã duyệt', value: code },
        { label: 'Mã hết hạn', value: `${at(expiresAt)} (sau ${CODE_TTL_MS / 60_000} phút)` },
        { label: 'Người xin', value: `${who} (${request.requester})` },
        { label: 'Đối tượng', value: subject?.label ?? 'Không xác định' },
        { label: 'Xin', value: asked },
        { label: 'Lý do', value: request.reason },
        { label: 'Gửi lúc', value: at(request.createdAt) },
      ],
      ctaLabel: 'Xem yêu cầu',
      ctaPath: UI_PATHS.approval(request.id),
      footnote:
        'Chỉ đọc mã cho đúng người xin. IMS không bao giờ hỏi lại mã này. ' +
        'Quyền cấp ra có thời hạn; thu hồi sớm được ở màn Duyệt mở két.',
    };
  }
}

function toStatus(
  row: { approver: string; sendNo: number; failedAttempts: number; codeExpiresAt: Date | null },
  now: Date,
): CodeStatus {
  const left = row.codeExpiresAt ? Math.floor((row.codeExpiresAt.getTime() - now.getTime()) / 1000) : null;
  return {
    approver: row.approver,
    resendsLeft: Math.max(0, CODE_MAX_SENDS - row.sendNo),
    attemptsLeft: Math.max(0, CODE_MAX_FAILED - row.failedAttempts),
    codeSecondsLeft: left === null ? null : Math.max(0, left),
  };
}
