import { Global, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';

/**
 * Sổ đăng ký "ai được nhìn thấy chủ thể nào" — hạ tầng dùng chung giữa `files` và `vault`.
 *
 * ===== VÌ SAO PHẢI LÀ SỔ ĐĂNG KÝ, KHÔNG PHẢI MỘT LỜI GỌI THẲNG =====
 *
 * Bài toán: kho file đính kèm phải tuân theo ma trận quyền ba tầng của két. Cách hiển nhiên
 * là cho `files` gọi `VaultApiService` — và `dependency-cruiser` chặn lại với
 * `base-must-not-import-biz`.
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
 * Cấm sạch những loại đó là đổi hành vi của một quyết định khác ("mọi vai đã đăng nhập đều
 * xem được đính kèm") mà không ai yêu cầu. Mặc-định-cấm nằm ở TRONG ma trận (`access-list.service.ts` trả `'denied'` khi không có
 * luật nào áp), và đó mới là chỗ nó thuộc về.
 */

/** Người quyết định quyền cho một nhóm loại chủ thể. */
export interface OwnerAccessChecker {
  /** Những `ownerType` mà người này nhận canh. */
  readonly ownerTypes: readonly string[];
  /** Ném lỗi (403) nếu `memberEmail` không được nhìn thấy chủ thể đó. */
  assertCanSee(memberEmail: string, ownerType: string, ownerId: string): Promise<void>;
}

/**
 * Những `ownerType` mà PHẢI có người canh.
 *
 * ===== VÌ SAO CẦN DANH SÁCH NÀY =====
 *
 * `assertCanRead` đi qua im lặng khi không ai đăng ký loại chủ thể đó, và với `subnet` /
 * `nat_rule` thì đúng — mặc-định-cấm của chúng nằm trong ma trận quyền, không nằm ở sổ này.
 * Nhưng với `service_account` và `isp` thì việc đăng ký là thứ DUY NHẤT đứng giữa Member và
 * đính kèm của những chủ thể đó.
 *
 * Việc đăng ký lại xảy ra trong `VaultApiService.onModuleInit`. Nếu một cách lắp module về
 * sau khiến hàm đó không chạy — đổi thứ tự `imports`, tách module, một `forwardRef` đặt sai —
 * thì mọi Member lấy lại quyền đọc đính kèm của `service_account`/`isp`, và KHÔNG có gì đỏ:
 * hệ thống khởi động bình thường, request trả 200, chỉ là hàng rào biến mất.
 *
 * `OwnerExistsRegistry` ngay bên cạnh đã fail-closed (không ai vouch được thì TỪ CHỐI). Sổ
 * này không làm thế được vì im lặng là câu trả lời đúng cho phần lớn loại chủ thể — nên nó
 * kiểm ở lúc BOOT thay vì lúc request: sai thì api không lên, thay vì lên và mở toang.
 */
const MUST_BE_GUARDED = ['service_account', 'isp'] as const;

@Injectable()
export class OwnerAccessRegistry implements OnApplicationBootstrap {
  private readonly checkers: OwnerAccessChecker[] = [];

  /**
   * Chạy SAU khi mọi `onModuleInit` đã xong — đó là lúc duy nhất biết được sổ đã đủ người canh
   * hay chưa. Ném thì Nest dừng khởi động, và đó là hành vi đúng: một api chạy được nhưng
   * thiếu hàng rào còn tệ hơn một api không chạy.
   */
  onApplicationBootstrap(): void {
    const guarded = new Set(this.checkers.flatMap((checker) => checker.ownerTypes));
    const missing = MUST_BE_GUARDED.filter((type) => !guarded.has(type));
    if (missing.length > 0) {
      throw new Error(
        `OwnerAccessRegistry: không ai canh quyền đọc cho ${missing.join(', ')}. ` +
          'Không có người canh thì `assertCanRead` đi qua im lặng và Member đọc được đính kèm ' +
          'của những chủ thể đó (lỗ C1). Kiểm `VaultApiService.onModuleInit` còn chạy không.',
      );
    }
  }

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
