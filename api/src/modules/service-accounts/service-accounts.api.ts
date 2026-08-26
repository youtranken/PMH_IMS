import { Injectable } from '@nestjs/common';
import { ServiceAccountService } from './service-account.service';
import type { ServiceAccountRecord } from './service-account.types';

/**
 * AD-2: public api DUY NHẤT của module `service-accounts`.
 *
 * Két sắt gọi qua đây để tra tên hồ sơ cho trang tổng và để chặn tham chiếu ma khi ai đó cất
 * secret vào một `ownerId` bịa ra. KHÔNG có hàm nào chạm tới mật khẩu — mật khẩu là việc của
 * module vault, module này chỉ giữ hồ sơ hành chính.
 */
@Injectable()
export class ServiceAccountsApiService {
  constructor(private readonly accounts: ServiceAccountService) {}

  getById(id: string): Promise<ServiceAccountRecord> {
    return this.accounts.findOne(id);
  }

  exists(id: string): Promise<boolean> {
    return this.accounts.exists(id);
  }
}
