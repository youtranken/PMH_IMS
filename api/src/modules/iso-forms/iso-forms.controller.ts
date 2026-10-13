import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { NoSecretText } from '../../common/no-secret-text';
import { RealDate } from '../../common/real-date';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import { NoStepUp } from '../auth/step-up.decorator';
import type { AuthedRequest } from '../auth/types';
import { IsoAntivirusService } from './iso-antivirus.service';
import { IsoBackupService } from './iso-backup.service';
import { IsoIncidentService, type CellInput } from './iso-incident.service';
import { IsoPeriodService } from './iso-period.service';
import {
  BACKUP_DATA_TYPES,
  BACKUP_DETAIL_MAX,
  BACKUP_TYPES,
  INCIDENT_KINDS,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  ISO_FORM_TYPES,
  parseMonthKey,
  type IncidentKind,
  type IncidentSeverity,
  type IncidentStatus,
  type IsoFormType,
} from './iso-rules';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

class MonthParamDto {
  @Matches(MONTH_RE, { message: 'Tháng phải dạng YYYY-MM.' }) month!: string;
}

class PeriodParamDto extends MonthParamDto {
  @IsIn([...ISO_FORM_TYPES], { message: 'Loại phiếu không hợp lệ.' }) formType!: IsoFormType;
}

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã không hợp lệ.' }) id!: string;
}

class DayParamDto {
  @Validate(RealDate) day!: string;
}

class TickDto {
  @IsUUID(undefined, { message: 'Mã dòng job không hợp lệ.' }) lineId!: string;
  @Validate(RealDate) day!: string;
  @ValidateIf((_o, v) => v !== null) @IsIn(['ok', 'fail'], { message: 'Kết quả chỉ là ✓ hoặc ✗.' }) result!: 'ok' | 'fail' | null;
}

class DayDto {
  @Validate(RealDate) day!: string;
}

class IssueDto {
  @Validate(RealDate, { message: 'Reported Date phải là ngày có thật.' }) reportedOn!: string;
  @ValidateIf((_o, v) => v !== null) @IsUUID(undefined, { message: 'Bộ phận không hợp lệ.' }) divisionId!: string | null;
  @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(120, { message: 'Tên bộ phận tối đa 120 ký tự.' }) newDivisionName!: string | null;
  @IsString() @Length(1, 80, { message: 'Computer Name từ 1 đến 80 ký tự.' }) computerName!: string;
  @IsString() @Length(1, 500, { message: 'Incident Description từ 1 đến 500 ký tự.' }) @NoSecretText('Incident Description') description!: string;
  @ValidateIf((_o, v) => v !== null) @Validate(RealDate, { message: 'Resolution Date phải là ngày có thật.' }) resolvedOn!: string | null;
  @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(80, { message: 'Handled tối đa 80 ký tự.' }) handledBy!: string | null;
}

class BackupDetailDto {
  @IsString() @MaxLength(120, { message: 'Job Name tối đa 120 ký tự.' }) jobName!: string;
  @ValidateIf((_o, v) => v !== null) @IsIn([...BACKUP_TYPES], { message: 'Type Backup không hợp lệ.' }) typeBackup!: (typeof BACKUP_TYPES)[number] | null;
  @ValidateIf((_o, v) => v !== null) @IsIn([...BACKUP_DATA_TYPES], { message: 'Type Data không hợp lệ.' }) typeData!: (typeof BACKUP_DATA_TYPES)[number] | null;
  @IsString() @MaxLength(60) storage!: string;
  @IsString() @MaxLength(300) @NoSecretText('Error Message') errorMessage!: string;
  @IsString() @MaxLength(300) @NoSecretText('Issue Resolution') resolution!: string;
}

class CellDto {
  @IsIn(['0203', '0208'], { message: 'Loại ô không hợp lệ.' }) form!: '0203' | '0208';
  @ValidateIf((o: CellDto) => o.form === '0203') @IsUUID(undefined, { message: 'Mã dòng job không hợp lệ.' }) lineId?: string;
  @ValidateIf((o: CellDto) => o.form === '0203') @Validate(RealDate) day?: string;
  @ValidateIf((o: CellDto) => o.form === '0208') @IsUUID(undefined, { message: 'Mã dòng issue không hợp lệ.' }) issueId?: string;
}

class IncidentDto {
  @Validate(RealDate, { message: 'Date Report phải là ngày có thật.' }) reportedOn!: string;
  @IsIn([...INCIDENT_KINDS], { message: 'Chọn Type of Incident.' }) kind!: IncidentKind;
  @IsISO8601({ strict: true }, { message: 'Detection Time không hợp lệ.' }) detectedAt!: string;
  @ValidateIf((_o, v) => v !== null) @IsISO8601({ strict: true }, { message: 'Resolution Time không hợp lệ.' }) resolvedAt!: string | null;
  @IsIn([...INCIDENT_SEVERITIES], { message: 'Chọn Severity Level.' }) severity!: IncidentSeverity;
  @IsIn([...INCIDENT_STATUSES], { message: 'Chọn Current Status.' }) status!: IncidentStatus;
  @IsString() @MaxLength(2000, { message: 'Incident Description tối đa 2000 ký tự.' }) @NoSecretText('Incident Description') description!: string;
  @IsString() @MaxLength(2000, { message: 'Corrective Action tối đa 2000 ký tự.' }) @NoSecretText('Corrective Action') correctiveAction!: string;
  @IsArray() @ArrayMaxSize(BACKUP_DETAIL_MAX, { message: `Detail Error Backup tối đa ${BACKUP_DETAIL_MAX} dòng.` }) @ValidateNested({ each: true }) @Type(() => BackupDetailDto)
  backupDetails!: BackupDetailDto[];
  @IsArray() @ArrayMaxSize(200, { message: 'Gắn tối đa 200 ô cho một phiếu.' }) @ValidateNested({ each: true }) @Type(() => CellDto)
  cells!: CellDto[];
}

class IncidentListQuery {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2999) year!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @IsIn([...INCIDENT_KINDS]) kind?: string;
  @IsOptional() @IsIn(['backup', 'antivirus', 'direct']) source?: 'backup' | 'antivirus' | 'direct';
  @IsOptional() @IsIn(['yes', 'no']) signed?: 'yes' | 'no';
}

class YearQuery {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2999) year!: number;
}

class NoteDto {
  @ValidateIf((_o, v) => v !== null) @IsOptional() @IsString() @MaxLength(1000, { message: 'Ghi chú tối đa 1000 ký tự.' }) @NoSecretText('Ghi chú') note?: string | null;
}

class ReasonDto {
  @IsString() @Length(1, 1000, { message: 'Lý do từ 1 đến 1000 ký tự.' }) @NoSecretText('Lý do') reason!: string;
}

function monthOfParam(key: string): { year: number; month: number } {
  return parseMonthKey(key)!;
}

function toCells(cells: CellDto[]): CellInput[] {
  return cells.map((c) => (c.form === '0203' ? { form: '0203', lineId: c.lineId!, day: c.day! } : { form: '0208', issueId: c.issueId! }));
}

/**
 * Phiếu ISO đợt 1 (Q-28): lưới 0203, lưới 0208, phiếu 0206 và luồng kỳ. Quyền ghi của từng phiếu
 * (người phụ trách + SA/Admin) kiểm trong service — `@Roles` ở đây chỉ chặn ngoài tài khoản IMS.
 */
@NoStepUp()
@Controller('api/v1/iso')
export class IsoFormsController {
  constructor(
    private readonly backup: IsoBackupService,
    private readonly antivirus: IsoAntivirusService,
    private readonly incidents: IsoIncidentService,
    private readonly periods: IsoPeriodService,
  ) {}

  /* ---------------------------------------------------------------- 0203 --- */

  @Roles('sa', 'admin', 'member')
  @Get('backup/:month')
  backupGrid(@Param() params: MonthParamDto, @Req() req: AuthedRequest) {
    const { year, month } = monthOfParam(params.month);
    return this.backup.grid(req.user!, year, month);
  }

  @Roles('sa', 'admin', 'member')
  @Put('backup/ticks')
  @Audited('iso_backup.tick_set', 'iso_backup_job', { writtenByService: true })
  setTick(@Body() dto: TickDto, @Req() req: AuthedRequest) {
    return this.backup.setTick(req.user!, dto);
  }

  @Roles('sa', 'admin', 'member')
  @Post('backup/fill-day')
  @Audited('iso_backup.day_filled', 'iso_period', { writtenByService: true })
  fillDay(@Body() dto: DayDto, @Req() req: AuthedRequest) {
    return this.backup.fillDay(req.user!, dto.day);
  }

  /* ---------------------------------------------------------------- 0208 --- */

  @Roles('sa', 'admin', 'member')
  @Get('antivirus/:month')
  antivirusGrid(@Param() params: MonthParamDto, @Req() req: AuthedRequest) {
    const { year, month } = monthOfParam(params.month);
    return this.antivirus.grid(req.user!, year, month);
  }

  @Roles('sa', 'admin', 'member')
  @Post('antivirus/clear-days')
  @Audited('iso_antivirus.day_cleared', 'iso_period', { writtenByService: true })
  markClear(@Body() dto: DayDto, @Req() req: AuthedRequest) {
    return this.antivirus.markClear(req.user!, dto.day);
  }

  @Roles('sa', 'admin', 'member')
  @Delete('antivirus/clear-days/:day')
  @Audited('iso_antivirus.day_uncleared', 'iso_period', { writtenByService: true })
  unmarkClear(@Param() params: DayParamDto, @Req() req: AuthedRequest) {
    return this.antivirus.unmarkClear(req.user!, params.day);
  }

  @Roles('sa', 'admin', 'member')
  @Post('antivirus/issues')
  @Audited(['iso_antivirus.issue_created', 'iso_division.created'], 'iso_av_issue', { writtenByService: true })
  createIssue(@Body() dto: IssueDto, @Req() req: AuthedRequest) {
    return this.antivirus.createIssue(req.user!, dto);
  }

  @Roles('sa', 'admin', 'member')
  @Patch('antivirus/issues/:id')
  @Audited(['iso_antivirus.issue_updated', 'iso_division.created'], 'iso_av_issue', { writtenByService: true })
  updateIssue(@Param() params: IdParamDto, @Body() dto: IssueDto, @Req() req: AuthedRequest) {
    return this.antivirus.updateIssue(req.user!, params.id, dto);
  }

  @Roles('sa', 'admin', 'member')
  @Delete('antivirus/issues/:id')
  @Audited('iso_antivirus.issue_deleted', 'iso_av_issue', { writtenByService: true })
  deleteIssue(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    return this.antivirus.deleteIssue(req.user!, params.id);
  }

  /* ---------------------------------------------------------------- 0206 --- */

  @Roles('sa', 'admin', 'member')
  @Get('incidents')
  async listIncidents(@Query() query: IncidentListQuery) {
    const [items, unlinked] = await Promise.all([this.incidents.list(query), this.incidents.unlinked({ year: query.year })]);
    return { items, unlinked };
  }

  /** Ô ✗ chưa có phiếu của các kỳ còn Đang ghi — khu "gắn thêm ô ✗" của form 0206. */
  @Roles('sa', 'admin', 'member')
  @Get('incidents/linkable')
  linkable() {
    return this.incidents.unlinked({});
  }

  @Roles('sa', 'admin', 'member')
  @Get('incidents/:id')
  incident(@Param() params: IdParamDto) {
    return this.incidents.get(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Post('incidents')
  @Audited('iso_incident.created', 'iso_incident', { writtenByService: true })
  createIncident(@Body() dto: IncidentDto, @Req() req: AuthedRequest) {
    return this.incidents.create(req.user!, { ...dto, cells: toCells(dto.cells) });
  }

  @Roles('sa', 'admin', 'member')
  @Patch('incidents/:id')
  @Audited('iso_incident.updated', 'iso_incident', { writtenByService: true })
  updateIncident(@Param() params: IdParamDto, @Body() dto: IncidentDto, @Req() req: AuthedRequest) {
    return this.incidents.update(req.user!, params.id, { ...dto, cells: toCells(dto.cells) });
  }

  /* ---------------------------------------------------------------- kỳ --- */

  @Roles('sa', 'admin', 'member')
  @Get('periods')
  overview(@Query() query: YearQuery, @Req() req: AuthedRequest) {
    return this.periods.overview(req.user!, query.year);
  }

  @Roles('sa', 'admin')
  @Get('pending')
  pending() {
    return this.periods.pendingRequests();
  }

  @Roles('sa', 'admin', 'member')
  @Get('todo')
  todo(@Req() req: AuthedRequest) {
    return this.periods.todo(req.user!);
  }

  @Roles('sa', 'admin', 'member')
  @Get('periods/:formType/:month')
  period(@Param() params: PeriodParamDto, @Req() req: AuthedRequest) {
    const { year, month } = monthOfParam(params.month);
    return this.periods.detail(req.user!, params.formType, year, month);
  }

  @Roles('sa', 'admin', 'member')
  @Post('periods/:formType/:month/submit')
  @Audited(['iso_period.submitted', 'iso_period_close.requested'], 'iso_period', { writtenByService: true })
  submit(@Param() params: PeriodParamDto, @Req() req: AuthedRequest) {
    const { year, month } = monthOfParam(params.month);
    return this.periods.submit(req.user!, params.formType, year, month);
  }

  @Roles('sa', 'admin')
  @Post('periods/:formType/:month/approve')
  @Audited(['iso_period.approved', 'iso_period_close.approved'], 'iso_period', { writtenByService: true })
  approve(@Param() params: PeriodParamDto, @Body() dto: NoteDto, @Req() req: AuthedRequest) {
    const { year, month } = monthOfParam(params.month);
    return this.periods.approve(req.user!, params.formType, year, month, dto.note?.trim() || null);
  }

  @Roles('sa', 'admin')
  @Post('periods/:formType/:month/return')
  @Audited(['iso_period.returned', 'iso_period_close.returned'], 'iso_period', { writtenByService: true })
  returnPeriod(@Param() params: PeriodParamDto, @Body() dto: ReasonDto, @Req() req: AuthedRequest) {
    const { year, month } = monthOfParam(params.month);
    return this.periods.returnToSender(req.user!, params.formType, year, month, dto.reason);
  }

  @Roles('sa', 'admin', 'member')
  @Post('periods/:formType/:month/reopen')
  @Audited(['iso_period.reopen_requested', 'iso_period_reopen.requested'], 'iso_period', { writtenByService: true })
  requestReopen(@Param() params: PeriodParamDto, @Body() dto: ReasonDto, @Req() req: AuthedRequest) {
    const { year, month } = monthOfParam(params.month);
    return this.periods.requestReopen(req.user!, params.formType, year, month, dto.reason);
  }

  @Roles('sa', 'admin')
  @Post('periods/:formType/:month/reopen/approve')
  @Audited(['iso_period.reopened', 'iso_period_reopen.approved'], 'iso_period', { writtenByService: true })
  approveReopen(@Param() params: PeriodParamDto, @Body() dto: NoteDto, @Req() req: AuthedRequest) {
    const { year, month } = monthOfParam(params.month);
    return this.periods.decideReopen(req.user!, params.formType, year, month, true, dto.note?.trim() || null);
  }

  @Roles('sa', 'admin')
  @Post('periods/:formType/:month/reopen/deny')
  @Audited(['iso_period.reopen_denied', 'iso_period_reopen.denied'], 'iso_period', { writtenByService: true })
  denyReopen(@Param() params: PeriodParamDto, @Body() dto: ReasonDto, @Req() req: AuthedRequest) {
    const { year, month } = monthOfParam(params.month);
    return this.periods.decideReopen(req.user!, params.formType, year, month, false, dto.reason);
  }
}
