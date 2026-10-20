import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf } from 'class-validator';
import { parsePageQuery } from '../../common/pagination';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import { NoStepUp } from '../auth/step-up.decorator';
import type { AuthedRequest } from '../auth/types';
import { DeviceModelsService } from './device-models.service';
import { DevicePhotosService, PHOTO_SIDES, type PhotoSide } from './device-photos.service';
import { FeatureFree } from '../auth/feature.decorator';

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã model không hợp lệ.' })
  id!: string;
}

class SideParamDto extends IdParamDto {
  @IsIn([...PHOTO_SIDES], { message: 'Mặt ảnh phải là front hoặc back.' })
  side!: PhotoSide;
}

class ListQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsUUID(undefined, { message: 'Loại thiết bị không hợp lệ.' }) deviceTypeId?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;
}

class CreateModelDto {
  @IsUUID(undefined, { message: 'Loại thiết bị không hợp lệ.' }) deviceTypeId!: string;
  @IsString() @Length(1, 120, { message: 'Mã model từ 1 đến 120 ký tự.' }) model!: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(0, 60, { message: 'Hãng tối đa 60 ký tự.' }) manufacturer?: string | null;
  @IsBoolean({ message: 'Gắn tủ phải là có hoặc không.' }) rackMountable!: boolean;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt({ message: 'Số U phải là số nguyên.' }) @Min(1) @Max(60) uSize?: number | null;
  /** Cổng mẫu: nhóm `pattern` + `kind`, `expandPortTemplate` kiểm. */
  @IsOptional() @IsArray({ message: 'Cổng mẫu phải là danh sách.' }) portTemplate?: unknown[];
}

class UpdateModelDto {
  @IsOptional() @IsUUID(undefined, { message: 'Loại thiết bị không hợp lệ.' }) deviceTypeId?: string;
  @IsOptional() @IsString() @Length(1, 120, { message: 'Mã model từ 1 đến 120 ký tự.' }) model?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(0, 60, { message: 'Hãng tối đa 60 ký tự.' }) manufacturer?: string | null;
  @IsOptional() @IsBoolean({ message: 'Gắn tủ phải là có hoặc không.' }) rackMountable?: boolean;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt({ message: 'Số U phải là số nguyên.' }) @Min(1) @Max(60) uSize?: number | null;
  @IsOptional() @IsArray({ message: 'Cổng mẫu phải là danh sách.' }) portTemplate?: unknown[];
}

/** `null` = bỏ ảnh của mặt đó; vắng = không đụng. */
class PhotoPairDto {
  @IsOptional() @ValidateIf((_o, value) => value !== null) @IsUUID(undefined, { message: 'Ảnh mặt trước không hợp lệ.' }) front?: string | null;
  @IsOptional() @ValidateIf((_o, value) => value !== null) @IsUUID(undefined, { message: 'Ảnh mặt sau không hợp lệ.' }) back?: string | null;
}

/**
 * Danh mục Model thiết bị (Q-26). Ai thêm được thiết bị thì TẠO được model mới (ngay trong form thiết
 * bị); SỬA / XOÁ / đổi ảnh model có sẵn đổi đặc tính của cả loạt máy nên chỉ SA/Admin — cùng luật ảnh
 * model của Q-23.
 */
@NoStepUp()
@FeatureFree()
@Controller('api/v1/device-models')
export class DeviceModelsController {
  constructor(
    private readonly models: DeviceModelsService,
    private readonly photos: DevicePhotosService,
  ) {}

  @Roles('sa', 'admin', 'member')
  @Get()
  list(@Query() query: ListQueryDto) {
    return this.models.list({ search: query.search, deviceTypeId: query.deviceTypeId, manufacturer: query.manufacturer }, parsePageQuery(query));
  }

  @Roles('sa', 'admin', 'member')
  @Get(':id')
  get(@Param() params: IdParamDto) {
    return this.models.get(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Post()
  @Audited('device.model-created', 'device_model', { writtenByService: true })
  create(@Body() body: CreateModelDto, @Req() req: AuthedRequest) {
    return this.models.create(req.user!.email, body);
  }

  @Roles('sa', 'admin')
  @Patch(':id')
  @Audited('device.model-updated', 'device_model', { writtenByService: true })
  update(@Param() params: IdParamDto, @Body() body: UpdateModelDto, @Req() req: AuthedRequest) {
    return this.models.update(req.user!.email, params.id, body);
  }

  /** Gán model này cho mọi máy ghi CHỮ model đó mà chưa gán (Q-26 07/10). */
  @Roles('sa', 'admin')
  @Post(':id/adopt')
  @HttpCode(200)
  @Audited('device.model-adopted', 'device_model', { writtenByService: true })
  adopt(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    return this.models.adopt(req.user!.email, params.id);
  }

  @Roles('sa', 'admin')
  @Delete(':id')
  @HttpCode(204)
  @Audited('device.model-deleted', 'device_model', { writtenByService: true })
  remove(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    return this.models.remove(req.user!.email, params.id);
  }

  @Roles('sa', 'admin')
  @Patch(':id/photos')
  @Audited('device.model-photos-changed', 'device_model', { writtenByService: true })
  async setPhotos(@Param() params: IdParamDto, @Body() body: PhotoPairDto, @Req() req: AuthedRequest) {
    await this.photos.setModelPhotosById(req.user!.email, params.id, body);
    return this.models.get(params.id);
  }

  /** Ảnh model đã thu nhỏ — cùng cách trả và cùng header khoá của ảnh xem trước thiết bị. */
  @Roles('sa', 'admin', 'member')
  @Get(':id/photo/:side')
  async preview(@Param() params: SideParamDto, @Res() res: Response) {
    const image = await this.photos.modelPreview(params.id, params.side);
    if (!image) throw new NotFoundException({ code: 'DEVICE_PHOTO_NOT_FOUND', message: 'Model chưa có ảnh mặt này.' });
    res.setHeader('Content-Type', image.mime);
    res.setHeader('Content-Length', String(image.bytes.length));
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(image.bytes);
  }
}
