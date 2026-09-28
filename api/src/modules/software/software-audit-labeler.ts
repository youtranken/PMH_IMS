import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import {
  AuditObjectLabelRegistry,
  type AuditObjectLabel,
  type AuditObjectLabeler,
} from '../../common/audit-object-labels.registry';
import { UI_PATHS } from '../../common/ui-paths';
import { ispLineTable, softwareTable } from './software.schema';

/** `software` gọi tên `software` ("mã — tên") và `isp_line` ("mã · nhà mạng") trên màn Nhật ký. */
@Injectable()
export class SoftwareAuditLabeler implements AuditObjectLabeler, OnModuleInit {
  readonly objectTypes = ['software', 'isp_line'] as const;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly registry: AuditObjectLabelRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelsFor(type: string, ids: string[]): Promise<Map<string, AuditObjectLabel>> {
    if (type === 'isp_line') {
      const rows = await this.db
        .select({ id: ispLineTable.id, code: ispLineTable.code, provider: ispLineTable.provider })
        .from(ispLineTable)
        .where(inArray(ispLineTable.id, ids));
      return new Map(
        rows.map((r) => [r.id, { label: `${r.code} · ${r.provider}`, path: UI_PATHS.ispLine(r.id) }]),
      );
    }
    const rows = await this.db
      .select({ id: softwareTable.id, code: softwareTable.code, name: softwareTable.name })
      .from(softwareTable)
      .where(inArray(softwareTable.id, ids));
    return new Map(
      rows.map((r) => [r.id, { label: `${r.code} — ${r.name}`, path: UI_PATHS.software(r.id) }]),
    );
  }
}
