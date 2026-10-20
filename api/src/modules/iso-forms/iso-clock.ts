import { Injectable } from '@nestjs/common';
import { isoDateInTz } from '../../common/today';
import { SystemConfigService } from '../config-sys/system-config.service';

/**
 * "Hôm nay" của phiếu ISO theo giờ Việt Nam (`app.timezone`), không theo giờ máy: từ 0 tới 7 giờ
 * sáng giờ UTC vẫn là ngày hôm qua, và ô của hôm nay sẽ bị khoá như ngày tương lai.
 *
 * Tách thành lớp riêng để bài kiểm DB đặt được ngày cố định mà không giả đồng hồ hệ thống.
 */
@Injectable()
export class IsoClock {
  constructor(private readonly config: SystemConfigService) {}

  now(): Date {
    return new Date();
  }

  async today(): Promise<string> {
    return isoDateInTz(await this.config.getString('appTimezone'), this.now());
  }

  async timeZone(): Promise<string> {
    return this.config.getString('appTimezone');
  }
}
