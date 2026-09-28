import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import { NoStepUp, RequiresStepUp } from '../auth/step-up.decorator';
import type { AuthedRequest } from '../auth/types';
import { SystemSettingsService } from './system-settings.service';

class SettingChangeDto {
  @IsString()
  @MaxLength(100)
  key!: string;

  /* Kiểu thật (số / chữ / danh sách) phụ thuộc từng khoá — `validateSetting` kiểm ở service. */
  @IsDefined()
  value!: unknown;
}

class UpdateSettingsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SettingChangeDto)
  changes!: SettingChangeDto[];
}

/**
 * Tham số hệ thống (Q-14) — CHỈ SA. Đây là nơi nới hay siết mọi hàng rào đăng nhập và két sắt,
 * nên sửa phải xác thực lại (step-up) và mỗi khoá đổi là một dòng nhật ký (AD-5, AD-9).
 * Đọc thì không đòi step-up: xem ngưỡng hiện tại không mở được gì.
 */
@NoStepUp()
@Controller('api/v1/admin/settings')
export class SystemSettingsController {
  constructor(private readonly settings: SystemSettingsService) {}

  @Roles('sa')
  @Get()
  list() {
    return this.settings.list();
  }

  @Roles('sa')
  @RequiresStepUp()
  @Patch()
  @Audited('system_config.updated', 'system_config', { writtenByService: true })
  update(@Body() dto: UpdateSettingsDto, @Req() req: AuthedRequest) {
    return this.settings.update(req.user!.email, dto.changes);
  }
}
