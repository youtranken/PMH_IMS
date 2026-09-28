import { Injectable } from '@nestjs/common';
import type { StatusEvent } from '../../common/history';
import type { Page } from '../../common/pagination';
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
    return (await this.disabledPage()).items;
  }

  /** Như `listDisabled`, kèm `total` thật để kho biết mình có bị cắt ở trần 500 dòng không. */
  disabledPage(): Promise<Page<ServiceAccountRecord>> {
    return this.accounts.list({ page: 1, limit: 500 }, { status: 'disabled' });
  }

  /** Ai vô hiệu hoá, khi nào, vì sao — kho thanh lý hỏi theo mẻ id. */
  disableEvents(ids: string[]): Promise<Map<string, StatusEvent>> {
    return this.accounts.disableEvents(ids);
  }
}
