import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { isoDateInTz } from '../../common/today';
import { SystemConfigService } from '../config-sys/system-config.service';
import { SweepService } from '../queue/sweep.service';
import { SoftwareService } from './software.service';

/** Cắm lượt đồng bộ trạng thái phần mềm theo hạn vào sweep của worker (DOM-03). */
@Injectable()
export class SoftwareStatusSweep implements OnModuleInit {
  private readonly logger = new Logger(SoftwareStatusSweep.name);

  constructor(
    private readonly software: SoftwareService,
    private readonly config: SystemConfigService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register({ name: 'software-expiry-status', run: () => this.run() });
  }

  private async run(): Promise<void> {
    const today = isoDateInTz(await this.config.getString('appTimezone'));
    const { expired, reactivated } = await this.software.syncExpiryStatuses(today);
    if (expired + reactivated > 0) {
      this.logger.log(`phần mềm: ${expired} sang Hết hạn, ${reactivated} về Đang dùng`);
    }
  }
}
