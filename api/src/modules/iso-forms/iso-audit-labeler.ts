import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { AuditObjectLabelRegistry, type AuditObjectLabel, type AuditObjectLabeler } from '../../common/audit-object-labels.registry';
import { UI_PATHS } from '../../common/ui-paths';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { isoAvIssueTable, isoBackupJobTable, isoDivisionTable, isoIncidentTable, isoPeriodTable } from './iso-forms.schema';
import { periodLabel } from './iso-period.store';
import { monthKey } from './iso-rules';

/** `iso-forms` gọi tên chủ thể của mình trên màn Nhật ký. */
@Injectable()
export class IsoAuditLabeler implements AuditObjectLabeler, OnModuleInit {
  readonly objectTypes = ['iso_period', 'iso_incident', 'iso_backup_job', 'iso_division', 'iso_av_issue'] as const;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly registry: AuditObjectLabelRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelsFor(type: string, ids: string[]): Promise<Map<string, AuditObjectLabel>> {
    switch (type) {
      case 'iso_period': {
        const rows = await this.db.select().from(isoPeriodTable).where(inArray(isoPeriodTable.id, ids));
        return new Map(
          rows.map((r) => [
            r.id,
            { label: `Kỳ ${periodLabel(r.formType, r.year, r.month)}`, path: UI_PATHS.isoPeriod(r.formType, monthKey(r.year, r.month)) },
          ]),
        );
      }
      case 'iso_incident': {
        const rows = await this.db
          .select({ id: isoIncidentTable.id, code: isoIncidentTable.code })
          .from(isoIncidentTable)
          .where(inArray(isoIncidentTable.id, ids));
        return new Map(rows.map((r) => [r.id, { label: `Phiếu ${r.code}`, path: UI_PATHS.isoIncident(r.id) }]));
      }
      case 'iso_backup_job': {
        const rows = await this.db
          .select({ id: isoBackupJobTable.id, no: isoBackupJobTable.no, name: isoBackupJobTable.name })
          .from(isoBackupJobTable)
          .where(inArray(isoBackupJobTable.id, ids));
        return new Map(rows.map((r) => [r.id, { label: `Job ${r.no} · ${r.name}`, path: null }]));
      }
      case 'iso_division': {
        const rows = await this.db
          .select({ id: isoDivisionTable.id, name: isoDivisionTable.name })
          .from(isoDivisionTable)
          .where(inArray(isoDivisionTable.id, ids));
        return new Map(rows.map((r) => [r.id, { label: `Bộ phận ${r.name}`, path: null }]));
      }
      default: {
        const rows = await this.db
          .select({ id: isoAvIssueTable.id, computer: isoAvIssueTable.computerName, day: isoAvIssueTable.reportedOn })
          .from(isoAvIssueTable)
          .where(inArray(isoAvIssueTable.id, ids));
        return new Map(
          rows.map((r) => [r.id, { label: `0208 · ${r.computer}`, path: UI_PATHS.isoAntivirusAt(r.day.slice(0, 7)) }]),
        );
      }
    }
  }
}
