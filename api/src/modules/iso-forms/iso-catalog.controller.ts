import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { RealDate } from '../../common/real-date';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import { NoStepUp } from '../auth/step-up.decorator';
import type { AuthedRequest } from '../auth/types';
import { IsoAccessService } from './iso-access.service';
import { IsoCatalogService } from './iso-catalog.service';
import { ISO_FORM_TYPES, type IsoFormType } from './iso-rules';

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã không hợp lệ.' })
  id!: string;
}

class FormParamDto {
  @IsIn([...ISO_FORM_TYPES], { message: 'Loại phiếu không hợp lệ.' })
  formType!: IsoFormType;
}

class JobListQuery {
  @IsOptional() @IsIn(['live', 'stopped', 'all'], { message: 'Trạng thái lọc không hợp lệ.' }) status?: 'live' | 'stopped' | 'all';
}

class JobLineDto {
  @IsOptional() @IsUUID(undefined, { message: 'Mã đối tượng con không hợp lệ.' }) id?: string;
  @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(120, { message: 'Tên đối tượng con tối đa 120 ký tự.' }) label!: string | null;
  @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(20, { message: 'Points NAS tối đa 20 ký tự.' }) pointsNas!: string | null;
  @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(60, { message: 'Storage location tối đa 60 ký tự.' }) storageNas!: string | null;
  @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(20, { message: 'Points Cloud tối đa 20 ký tự.' }) pointsCloud!: string | null;
  @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(60, { message: 'Storage location tối đa 60 ký tự.' }) storageCloud!: string | null;
}

class JobDto {
  @IsInt({ message: 'Số thứ tự (No) phải là số nguyên.' }) @Min(1, { message: 'No từ 1 trở lên.' }) @Max(999, { message: 'No tối đa 999.' }) no!: number;
  @IsString() @Length(1, 120, { message: 'Name Job Backup từ 1 đến 120 ký tự.' }) name!: string;
  @Validate(RealDate, { message: 'Ngày theo dõi từ phải là ngày có thật, dạng YYYY-MM-DD.' }) trackedFrom!: string;
  @IsArray()
  @ArrayMinSize(1, { message: 'Job phải có ít nhất một dòng.' })
  @ArrayMaxSize(20, { message: 'Một job tối đa 20 đối tượng con.' })
  @ValidateNested({ each: true })
  @Type(() => JobLineDto)
  lines!: JobLineDto[];
}

class StopDto {
  @Validate(RealDate, { message: 'Ngày ngừng phải là ngày có thật, dạng YYYY-MM-DD.' }) stoppedOn!: string;
}

class MoveDto {
  @IsIn(['up', 'down'], { message: 'Hướng không hợp lệ.' }) direction!: 'up' | 'down';
}

class DivisionDto {
  @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(20, { message: 'Mã bộ phận tối đa 20 ký tự.' }) code!: string | null;
  @IsString() @Length(1, 120, { message: 'Tên bộ phận từ 1 đến 120 ký tự.' }) name!: string;
}

class DivisionUpdateDto extends DivisionDto {
  @IsBoolean({ message: 'Trạng thái bộ phận không hợp lệ.' }) active!: boolean;
}

class OwnersDto {
  @ValidateIf((_o, v) => v !== null) @IsUUID(undefined, { message: 'Người phụ trách chính không hợp lệ.' }) primaryUserId!: string | null;
  @ValidateIf((_o, v) => v !== null) @IsUUID(undefined, { message: 'Người dự phòng không hợp lệ.' }) backupUserId!: string | null;
}

/**
 * Danh mục phiếu ISO: job backup, bộ phận, người phụ trách. Job và bộ phận mọi tài
 * khoản IT sửa được; người phụ trách chỉ SA/Admin gán.
 */
@NoStepUp()
@Controller('api/v1/iso/catalog')
export class IsoCatalogController {
  constructor(
    private readonly catalog: IsoCatalogService,
    private readonly access: IsoAccessService,
  ) {}

  @Roles('sa', 'admin', 'member')
  @Get('jobs')
  jobs(@Query() query: JobListQuery) {
    return this.catalog.jobs(query.status ?? 'all');
  }

  @Roles('sa', 'admin', 'member')
  @Post('jobs')
  @Audited('iso_job.created', 'iso_backup_job', { writtenByService: true })
  createJob(@Body() dto: JobDto, @Req() req: AuthedRequest) {
    return this.catalog.createJob(req.user!, dto);
  }

  @Roles('sa', 'admin', 'member')
  @Patch('jobs/:id')
  @Audited('iso_job.updated', 'iso_backup_job', { writtenByService: true })
  updateJob(@Param() params: IdParamDto, @Body() dto: JobDto, @Req() req: AuthedRequest) {
    return this.catalog.updateJob(req.user!, params.id, dto);
  }

  @Roles('sa', 'admin', 'member')
  @Post('jobs/:id/stop')
  @Audited('iso_job.stopped', 'iso_backup_job', { writtenByService: true })
  stopJob(@Param() params: IdParamDto, @Body() dto: StopDto, @Req() req: AuthedRequest) {
    return this.catalog.stopJob(req.user!, params.id, dto.stoppedOn);
  }

  @Roles('sa', 'admin', 'member')
  @Post('jobs/:id/resume')
  @Audited('iso_job.resumed', 'iso_backup_job', { writtenByService: true })
  resumeJob(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    return this.catalog.resumeJob(req.user!, params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Post('jobs/:id/move')
  @Audited('iso_job.moved', 'iso_backup_job', { writtenByService: true })
  moveJob(@Param() params: IdParamDto, @Body() dto: MoveDto, @Req() req: AuthedRequest) {
    return this.catalog.moveJob(req.user!, params.id, dto.direction);
  }

  @Roles('sa', 'admin', 'member')
  @Get('divisions')
  divisions() {
    return this.catalog.divisions();
  }

  @Roles('sa', 'admin', 'member')
  @Post('divisions')
  @Audited('iso_division.created', 'iso_division', { writtenByService: true })
  createDivision(@Body() dto: DivisionDto, @Req() req: AuthedRequest) {
    return this.catalog.createDivision(req.user!, dto);
  }

  @Roles('sa', 'admin', 'member')
  @Patch('divisions/:id')
  @Audited('iso_division.updated', 'iso_division', { writtenByService: true })
  updateDivision(@Param() params: IdParamDto, @Body() dto: DivisionUpdateDto, @Req() req: AuthedRequest) {
    return this.catalog.updateDivision(req.user!, params.id, dto);
  }

  @Roles('sa', 'admin', 'member')
  @Get('owners')
  owners() {
    return this.access.owners();
  }

  /** Danh sách chọn người phụ trách — chỉ tên + email của tài khoản còn hoạt động. */
  @Roles('sa', 'admin')
  @Get('people')
  people() {
    return this.access.people();
  }

  @Roles('sa', 'admin')
  @Put('owners/:formType')
  @Audited('iso_owner.updated', 'iso_form_owner', { writtenByService: true })
  setOwners(@Param() params: FormParamDto, @Body() dto: OwnersDto, @Req() req: AuthedRequest) {
    return this.access.setOwners(req.user!, params.formType, dto);
  }
}
