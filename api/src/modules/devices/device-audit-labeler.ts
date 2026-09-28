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
import { deviceTable } from './devices.schema';

/** `devices` gọi tên đối tượng `device` trên màn Nhật ký: "mã — tên", link tới hồ sơ máy. */
@Injectable()
export class DeviceAuditLabeler implements AuditObjectLabeler, OnModuleInit {
  readonly objectTypes = ['device'] as const;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly registry: AuditObjectLabelRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelsFor(_type: string, ids: string[]): Promise<Map<string, AuditObjectLabel>> {
    const rows = await this.db
      .select({ id: deviceTable.id, code: deviceTable.code, name: deviceTable.name })
      .from(deviceTable)
      .where(inArray(deviceTable.id, ids));
    return new Map(
      rows.map((r) => [r.id, { label: `${r.code} — ${r.name}`, path: UI_PATHS.device(r.id) }]),
    );
  }
}
