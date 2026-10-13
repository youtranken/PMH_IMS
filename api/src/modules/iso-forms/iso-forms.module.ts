import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { UsersModule } from '../users/users.module';
import { IsoAccessService } from './iso-access.service';
import { IsoAntivirusService } from './iso-antivirus.service';
import { IsoAuditLabeler } from './iso-audit-labeler';
import { IsoBackupService } from './iso-backup.service';
import { IsoCatalogController } from './iso-catalog.controller';
import { IsoCatalogService } from './iso-catalog.service';
import { IsoClock } from './iso-clock';
import { IsoFileOwner } from './iso-file-owner';
import { IsoFormsApiService } from './iso-forms.api';
import { IsoFormsController } from './iso-forms.controller';
import { IsoIncidentService } from './iso-incident.service';
import { IsoMailContent } from './iso-mail';
import { IsoReminderService } from './iso-reminder.service';
import { IsoPeriodService } from './iso-period.service';
import { IsoPeriodStore } from './iso-period.store';

/**
 * Chủ sở hữu mọi bảng `iso_*` của phiếu ISO đợt 1 (Q-28, AD-3). Ra ngoài chỉ xuất
 * `IsoFormsApiService` (AD-2).
 */
@Module({
  imports: [AuditModule, ApprovalsModule, FilesModule, UsersModule],
  controllers: [IsoCatalogController, IsoFormsController],
  providers: [
    IsoClock,
    IsoAccessService,
    IsoPeriodStore,
    IsoCatalogService,
    IsoBackupService,
    IsoAntivirusService,
    IsoIncidentService,
    IsoPeriodService,
    IsoFileOwner,
    IsoAuditLabeler,
    IsoMailContent,
    IsoReminderService,
    IsoFormsApiService,
  ],
  exports: [IsoFormsApiService],
})
export class IsoFormsModule {}
