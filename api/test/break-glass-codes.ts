import type { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import { MailContentRegistry } from '../src/common/mail-content.registry';
import type { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import type { ApprovalsApiService } from '../src/modules/approvals/approvals.api';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { OutboxService } from '../src/modules/outbox/outbox.service';
import type { UsersApiService } from '../src/modules/users/users.api';
import type { BreakGlassService, BreakGlassViewer } from '../src/modules/vault/break-glass.service';
import { BREAK_GLASS_CODE_TOPIC, BreakGlassCodeService } from '../src/modules/vault/break-glass-code.service';
import type { Database } from '../src/database/database.module';

/**
 * Dựng `BreakGlassCodeService` thật cho bài DB (Q-30) và đi đúng đường người dùng đi: worker dựng
 * thư → đọc mã trong thư → người xin nhập mã. Không có lối tắt "duyệt thẳng" nào trong service.
 */
export function breakGlassCodes(deps: {
  db: Database;
  outbox: OutboxService;
  approvals: ApprovalsApiService;
  kinds: ApprovalKindRegistry;
  users: UsersApiService;
  config: SystemConfigService;
}): { codes: BreakGlassCodeService; contents: MailContentRegistry } {
  const contents = new MailContentRegistry();
  const codes = new BreakGlassCodeService(
    deps.db,
    { currentKeyVersion: 1, deriveKeyAt: () => Buffer.alloc(32, 3) } as unknown as EnvelopeCryptoService,
    new AuditWriterService(deps.db),
    deps.outbox,
    deps.approvals,
    deps.kinds,
    deps.users,
    contents,
    deps.config,
  );
  codes.onModuleInit();
  return { codes, contents };
}

/** Mã trong thư lượt `sendNo` của yêu cầu. */
export async function mailedCode(contents: MailContentRegistry, approvalId: string, sendNo = 1): Promise<string> {
  const mail = await contents.find(BREAK_GLASS_CODE_TOPIC)!({ approvalId, sendNo });
  const code = mail?.rows.find((r) => r.label === 'Mã duyệt')?.value;
  if (!code) throw new Error(`thư lượt ${sendNo} của ${approvalId} không mang mã`);
  return code;
}

/** Người xin nhập mã người duyệt đọc cho — quyền gắn vào phiên `viewer.sessionId`. */
export async function approveByCode(
  breakGlass: BreakGlassService,
  contents: MailContentRegistry,
  viewer: BreakGlassViewer,
  approvalId: string,
) {
  return breakGlass.submitCode(viewer, approvalId, await mailedCode(contents, approvalId));
}
