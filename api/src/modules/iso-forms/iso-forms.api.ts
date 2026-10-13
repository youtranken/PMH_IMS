import { Injectable } from '@nestjs/common';
import type { IsoActor } from './iso-access.service';
import { IsoPeriodService } from './iso-period.service';

/**
 * AD-2: public api DUY NHẤT của module `iso-forms`. Module khác (bảng điều khiển) hỏi "người này
 * còn việc phiếu ISO nào" qua đây, KHÔNG query bảng `iso_*`.
 */
@Injectable()
export class IsoFormsApiService {
  constructor(private readonly periods: IsoPeriodService) {}

  todo(actor: IsoActor): ReturnType<IsoPeriodService['todo']> {
    return this.periods.todo(actor);
  }
}
