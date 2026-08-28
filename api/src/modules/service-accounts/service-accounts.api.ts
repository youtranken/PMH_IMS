import { Injectable } from '@nestjs/common';
import { ServiceAccountService } from './service-account.service';
import type { ServiceAccountRecord } from './service-account.types';

/**
 * AD-2: public api DUY NHẤT của module `service-accounts`.
 *
 * Két sắt gọi `getById` qua đây để tra tên hồ sơ cho trang tổng. KHÔNG có hàm nào chạm tới
 * mật khẩu — mật khẩu là việc của module vault, module này chỉ giữ hồ sơ hành chính.
 *
 * `exists` để sẵn cho việc chặn tham chiếu ma (module khác nhận `serviceAccountId` từ người
 * dùng), giống `devices.api`/`software.api`. Nói rõ để khỏi hiểu nhầm: HIỆN TẠI vault KHÔNG
 * gọi nó — vault chưa bao giờ kiểm chủ thể có tồn tại không, kể cả với thiết bị và phần mềm.
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

  /** Tài khoản đã vô hiệu hóa — màn Kho thanh lý gom qua đây. */
  async listDisabled(): Promise<ServiceAccountRecord[]> {
    const page = await this.accounts.list({ page: 1, limit: 500 }, { status: 'disabled' });
    return page.items;
  }
}
