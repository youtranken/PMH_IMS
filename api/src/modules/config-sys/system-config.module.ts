import { Global, Module } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsService } from './system-settings.service';

/** Global vì gần như module nào cũng cần đọc ngưỡng vận hành (AD-11). */
@Global()
@Module({
  controllers: [SystemSettingsController],
  providers: [SystemConfigService, SystemSettingsService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
