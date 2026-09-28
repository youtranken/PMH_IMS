import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import {
  AuditObjectLabelRegistry,
  type AuditObjectLabel,
  type AuditObjectLabeler,
} from '../../common/audit-object-labels.registry';
import { ApprovalKindRegistry } from '../../common/approvals/approvals-registry';
import { UI_PATHS } from '../../common/ui-paths';
import { approvalTable } from './approvals.schema';

/**
 * `approvals` gọi tên đối tượng `approval` trên màn Nhật ký: "người xin · mã đối tượng", link tới
 * trang phiếu. Tên đối tượng hỏi qua `ApprovalKindRegistry.describe` — module chủ loại phiếu dạy
 * sổ đó cách gọi tên, ở đây không tự đoán.
 */
@Injectable()
export class ApprovalAuditLabeler implements AuditObjectLabeler, OnModuleInit {
  readonly objectTypes = ['approval'] as const;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly registry: AuditObjectLabelRegistry,
    private readonly kinds: ApprovalKindRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelsFor(_type: string, ids: string[]): Promise<Map<string, AuditObjectLabel>> {
    const rows = await this.db
      .select({
        id: approvalTable.id,
        kind: approvalTable.kind,
        requester: approvalTable.requester,
        subjectType: approvalTable.subjectType,
        subjectId: approvalTable.subjectId,
      })
      .from(approvalTable)
      .where(inArray(approvalTable.id, ids));
    const out = new Map<string, AuditObjectLabel>();
    for (const row of rows) {
      const subject = await this.kinds
        .describe(row.kind, row.subjectType, row.subjectId)
        .catch(() => null);
      out.set(row.id, {
        label: subject ? `${row.requester} · ${subject.code}` : row.requester,
        path: UI_PATHS.approval(row.id),
      });
    }
    return out;
  }
}
