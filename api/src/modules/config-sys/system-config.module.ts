import { Global, Module } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';

/** Global vì gần như module nào cũng cần đọc ngưỡng vận hành (AD-11). */
@Global()
@Module({
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
