import { Global, Injectable, Module } from '@nestjs/common';

/**
 * Sổ đăng ký "ai được nhìn thấy chủ thể nào" — hạ tầng dùng chung giữa `files` và `vault`.
 *
 * ===== VÌ SAO PHẢI LÀ SỔ ĐĂNG KÝ, KHÔNG PHẢI MỘT LỜI GỌI THẲNG =====
 *
 * Bài toán (rà soát 07/09, C1): kho file đính kèm phải tuân theo ma trận quyền ba tầng của
 * két. Cách hiển nhiên là cho `files` gọi `VaultApiService` — và tôi đã viết đúng như thế,
 * rồi `dependency-cruiser` chặn lại với `base-must-not-import-biz`.
 *
 * Nó chặn ĐÚNG. `files` là module NỀN: `devices`, `software`, `isp`, `service-accounts`,
 * `ipam` đều đính kèm được. Cho nền biết tới một module nghiệp vụ cụ thể là đảo ngược chiều
 * phụ thuộc của cả hệ thống — hôm nay là `vault`, ngày mai thêm một luật quyền nữa thì `files`
 * lại phải biết thêm một module nữa, và cuối cùng module nền phụ thuộc vào tất cả.
 *
 * Nên chiều đi ngược lại: `files` ĐỌC sổ, `vault` GHI vào sổ lúc khởi động. `files` chỉ biết
 * "có ai đó quyết định quyền cho loại chủ thể này không", không biết ai.
 *
 * Đây là khuôn đã dùng ba lần trong repo — `DevicePanelRegistry`, `ExpirySourceRegistry`,
 * `ApprovalKindRegistry` — và cũng vì đúng lý do đó.
 *
 * ===== MẶC ĐỊNH KHI KHÔNG CÓ AI ĐĂNG KÝ =====
 *
 * `assertCanRead` KHÔNG ném khi loại chủ thể chưa có người canh. Nghe ngược với "mặc định
 * cấm", nên phải nói rõ: sổ này chỉ trả lời "ma trận quyền nói gì", và có những loại chủ thể
 * (`subnet`, `nat_rule`) mà ma trận KHÔNG phủ — với chúng khái niệm tầng quyền không tồn tại.
 * Cấm sạch những loại đó là đổi hành vi của một quyết định khác (story 2.3) mà không ai yêu
 * cầu. Mặc-định-cấm nằm ở TRONG ma trận (`access-list.service.ts` trả `'denied'` khi không có
 * luật nào áp), và đó mới là chỗ nó thuộc về.
 */

/** Người quyết định quyền cho một nhóm loại chủ thể. */
export interface OwnerAccessChecker {
  /** Những `ownerType` mà người này nhận canh. */
  readonly ownerTypes: readonly string[];
  /** Ném lỗi (403) nếu `memberEmail` không được nhìn thấy chủ thể đó. */
  assertCanSee(memberEmail: string, ownerType: string, ownerId: string): Promise<void>;
}

@Injectable()
export class OwnerAccessRegistry {
  private readonly checkers: OwnerAccessChecker[] = [];

  register(checker: OwnerAccessChecker): void {
    // Đăng ký hai lần (hot-reload, test dựng module nhiều lần) không được canh hai lượt.
    if (this.checkers.includes(checker)) return;
    this.checkers.push(checker);
  }

  /**
   * Ném nếu có người canh loại chủ thể này VÀ người đó từ chối.
   *
   * Cố ý KHÔNG bắt lỗi: khác với `DevicePanelRegistry` (một khu hỏng không được làm sập cả
   * trang), ở đây "không kiểm được quyền" phải thành từ chối, không được thành cho qua.
   */
  async assertCanRead(memberEmail: string, ownerType: string, ownerId: string): Promise<void> {
    for (const checker of this.checkers) {
      if (checker.ownerTypes.includes(ownerType)) {
        await checker.assertCanSee(memberEmail, ownerType, ownerId);
      }
    }
  }
}

@Global()
@Module({
  providers: [OwnerAccessRegistry],
  exports: [OwnerAccessRegistry],
})
export class OwnerAccessModule {}
