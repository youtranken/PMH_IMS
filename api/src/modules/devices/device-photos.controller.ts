import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import { NoStepUp } from '../auth/step-up.decorator';
import type { AuthedRequest } from '../auth/types';
import { DevicePhotosService, PHOTO_SIDES, type PhotoSide } from './device-photos.service';

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã thiết bị không hợp lệ.' })
  id!: string;
}

class SideParamDto extends IdParamDto {
  @IsIn([...PHOTO_SIDES], { message: 'Mặt ảnh phải là front hoặc back.' })
  side!: PhotoSide;
}

/** `null` = bỏ ảnh của mặt đó; vắng = không đụng. */
class PhotoPairDto {
  @IsOptional() @ValidateIf((_o, value) => value !== null) @IsUUID(undefined, { message: 'Ảnh mặt trước không hợp lệ.' }) front?: string | null;
  @IsOptional() @ValidateIf((_o, value) => value !== null) @IsUUID(undefined, { message: 'Ảnh mặt sau không hợp lệ.' }) back?: string | null;
}

/**
 * Ảnh thật của thiết bị (Q-23, Story 10.11): ảnh riêng máy chọn từ giấy tờ đính kèm, ảnh theo
 * model tải lên cho (loại + model). Cùng quyền với sửa hồ sơ thiết bị — việc hằng ngày của cả team.
 */
@NoStepUp()
@Controller('api/v1/devices')
export class DevicePhotosController {
  constructor(private readonly photos: DevicePhotosService) {}

  @Roles('sa', 'admin', 'member')
  @Get(':id/photos')
  list(@Param() params: IdParamDto) {
    return this.photos.photos(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Patch(':id/photos')
  @Audited('device.photos-changed', 'device', { writtenByService: true })
  setDevicePhotos(@Param() params: IdParamDto, @Body() body: PhotoPairDto, @Req() req: AuthedRequest) {
    return this.photos.setDevicePhotos(req.user!.email, params.id, body);
  }

  /** Hàng model của máy để tải ảnh model lên (`files` với `owner_type = 'device_model'`). */
  @Roles('sa', 'admin', 'member')
  @Post(':id/model')
  @Audited('device.model-created', 'device_model', { writtenByService: true })
  ensureModel(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    return this.photos.ensureModel(req.user!.email, params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Patch(':id/model-photos')
  @Audited('device.model-photos-changed', 'device_model', { writtenByService: true })
  setModelPhotos(@Param() params: IdParamDto, @Body() body: PhotoPairDto, @Req() req: AuthedRequest) {
    return this.photos.setModelPhotos(req.user!.email, params.id, body);
  }

  /**
   * Ảnh đang dùng của một mặt, đã thu nhỏ — xem trước trên trang thiết bị. Khác `files/:id/download`
   * (luôn `attachment`): đây là ảnh server đã giải mã và vẽ lại / đã kiểm theo nội dung lúc tải lên,
   * kiểu nội dung là ảnh thật, nên hiện thẳng trong `<img>` được mà không mở đường chạy HTML.
   */
  @Roles('sa', 'admin', 'member')
  @Get(':id/photo/:side')
  async preview(@Param() params: SideParamDto, @Res() res: Response) {
    const image = await this.photos.preview(params.id, params.side);
    if (!image) throw new NotFoundException({ code: 'DEVICE_PHOTO_NOT_FOUND', message: 'Máy chưa có ảnh mặt này.' });
    res.setHeader('Content-Type', image.mime);
    res.setHeader('Content-Length', String(image.bytes.length));
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(image.bytes);
  }
}
