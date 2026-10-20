import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { Audited } from '../audit/audited.decorator';
import { FeatureGroupsAdminService } from './feature-groups-admin.service';
import { FeatureFree } from './feature.decorator';
import { Roles } from './roles.decorator';
import { NoStepUp } from './step-up.decorator';
import type { AuthedRequest } from './types';

class CreateGroupDto {
  @IsString({ message: 'Nhập tên nhóm.' })
  @MaxLength(60, { message: 'Tên nhóm tối đa 60 ký tự.' })
  name!: string;

  @IsArray({ message: 'Danh sách mục phải là mảng.' })
  @ArrayMaxSize(20)
  @IsString({ each: true })
  features!: string[];
}

class UpdateGroupDto {
  @IsOptional()
  @IsString({ message: 'Nhập tên nhóm.' })
  @MaxLength(60, { message: 'Tên nhóm tối đa 60 ký tự.' })
  name?: string;

  @IsOptional()
  @IsArray({ message: 'Danh sách mục phải là mảng.' })
  @ArrayMaxSize(20)
  @IsString({ each: true })
  features?: string[];
}

/**
 * Nhóm quyền của Thành viên (Q-31) — CHỈ SA. Không đòi mã 6 số: nhóm chỉ thu hẹp quyền Member,
 * không bao giờ cho thêm. Mọi route ghi vẫn có @Audited (AD-9).
 */
@NoStepUp()
@FeatureFree()
@Controller('api/v1/feature-groups')
export class FeatureGroupsController {
  constructor(private readonly groups: FeatureGroupsAdminService) {}

  @Roles('sa')
  @Get()
  list() {
    return this.groups.list();
  }

  @Roles('sa')
  @Post()
  @Audited('feature_group.created', 'feature_group', { writtenByService: true })
  create(@Body() dto: CreateGroupDto, @Req() req: AuthedRequest) {
    return this.groups.create(actor(req), dto);
  }

  @Roles('sa')
  @Patch(':id')
  @Audited('feature_group.updated', 'feature_group', { writtenByService: true })
  @HttpCode(204)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupDto, @Req() req: AuthedRequest) {
    await this.groups.update(actor(req), id, dto);
  }

  @Roles('sa')
  @Delete(':id')
  @Audited('feature_group.deleted', 'feature_group', { writtenByService: true })
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    await this.groups.remove(actor(req), id);
  }
}

function actor(req: AuthedRequest) {
  return { id: req.user!.id, email: req.user!.email };
}
