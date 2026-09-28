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
import { serviceAccountTable } from './service-account.schema';

/** `service-accounts` gọi tên `service_account` trên màn Nhật ký: "mã — tên". */
@Injectable()
export class ServiceAccountAuditLabeler implements AuditObjectLabeler, OnModuleInit {
  readonly objectTypes = ['service_account'] as const;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly registry: AuditObjectLabelRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelsFor(_type: string, ids: string[]): Promise<Map<string, AuditObjectLabel>> {
    const rows = await this.db
      .select({ id: serviceAccountTable.id, code: serviceAccountTable.code, name: serviceAccountTable.name })
      .from(serviceAccountTable)
      .where(inArray(serviceAccountTable.id, ids));
    return new Map(
      rows.map((r) => [
        r.id,
        { label: `${r.code} — ${r.name}`, path: UI_PATHS.serviceAccount(r.id) },
      ]),
    );
  }
}
