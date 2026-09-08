import { BadRequestException, Global, Injectable, Module } from '@nestjs/common';

/**
 * Sổ đăng ký "chủ thể này có thật không" — hỏi trước khi gắn BẤT CỨ THỨ GÌ vào một
 * `ownerType` + `ownerId` do người dùng gửi lên.
 *
 * ===== BÀI TOÁN =====
 *
 * `FilesService.save` nhận `ownerType`/`ownerId` rồi ghi thẳng, không kiểm chủ thể có tồn tại
 * hay không. Két sắt cũng vậy. Nghĩa là POST một `ownerId` bịa ra là:
 *   - tạo được một file MỒ CÔI — không màn nào hiện nó, không ai dọn, mà blob vẫn nằm trên
 *     đĩa và vẫn tính vào dung lượng;
 *   - cất được một bí mật vào một cái két không thuộc về ai — vĩnh viễn không ai mở lại được,
 *     kể cả chính người vừa cất.
 *
 * Chú thích ngay trong `files.service.ts` đã ghi rõ rủi ro này ("gửi `ownerType` bịa ra thì
 * file thành mồ côi") mà không có hàng rào nào đi kèm.
 *
 * ===== VÌ SAO PHẢI LÀ SỔ ĐĂNG KÝ =====
 *
 * `files` là module NỀN — `devices`, `software`, `ipam`, `service-accounts` đều đính kèm được.
 * Cho nó import bốn module nghiệp vụ đó là đảo ngược chiều phụ thuộc của cả hệ thống, và
 * `dependency-cruiser` chặn bằng `base-must-not-import-biz`. Nên chiều đi ngược: `files` ĐỌC
 * sổ, module CHỦ SỞ HỮU ghi vào sổ lúc khởi động.
 *
 * Khuôn này đã dùng bốn lần — `DevicePanelRegistry`, `ExpirySourceRegistry`,
 * `OwnerAccessRegistry`, `DeviceRetirementRegistry` — và cũng vì đúng lý do đó.
 *
 * ===== KHÁC GÌ `OwnerAccessRegistry` =====
 *
 * Hai câu hỏi khác nhau, đừng gộp:
 *   - sổ này: "chủ thể này CÓ THẬT không" — chủ sở hữu bảng trả lời;
 *   - `OwnerAccessRegistry`: "người này ĐƯỢC XEM nó không" — ma trận quyền của két trả lời.
 * Một chủ thể có thật mà người dùng không được xem, và một `ownerId` bịa ra, là hai lỗi khác
 * nhau với hai câu trả lời khác nhau.
 *
 * ===== LOẠI CHƯA AI ĐĂNG KÝ THÌ TỪ CHỐI =====
 *
 * Ngược với `OwnerAccessRegistry` (không ai canh thì ĐI QUA), ở đây không ai vouch được thì
 * PHẢI từ chối. Lý do: `ownerType` đã qua `@IsIn(...)` ở DTO, nên một loại hợp lệ mà không có
 * người giải quyết chỉ có thể nghĩa là THIẾU REGISTRAR — một lỗi lập trình. Cho đi qua là
 * dựng một hàng rào khớp đúng số không chuỗi, đúng lớp lỗi đã lặp ba lần trong repo này.
 */

/** Module chủ sở hữu một nhóm loại chủ thể. */
export interface OwnerResolver {
  /** Những `ownerType` mà module này làm chủ. */
  readonly ownerTypes: readonly string[];
  /**
   * Nhãn đọc được của chủ thể, hoặc `null` nếu không tồn tại.
   *
   * Trả NHÃN chứ không trả boolean để thông điệp lỗi ở tầng trên gọi đúng tên thứ người dùng
   * vừa chọn, và để nơi gọi khỏi phải hỏi lần thứ hai.
   */
  labelFor(ownerType: string, ownerId: string): Promise<string | null>;
}

@Injectable()
export class OwnerExistsRegistry {
  private readonly resolvers: OwnerResolver[] = [];

  register(resolver: OwnerResolver): void {
    if (this.resolvers.includes(resolver)) return;
    this.resolvers.push(resolver);
  }

  /** Nhãn của chủ thể, hoặc `null` nếu không có thật. Ném nếu không ai làm chủ loại đó. */
  async labelFor(ownerType: string, ownerId: string): Promise<string | null> {
    const resolver = this.resolvers.find((r) => r.ownerTypes.includes(ownerType));
    if (!resolver) {
      throw new BadRequestException({
        code: 'OWNER_TYPE_UNRESOLVABLE',
        message:
          `Không xác minh được chủ thể loại "${ownerType}" — chưa module nào nhận làm chủ loại này. ` +
          'Đây là lỗi cấu hình của hệ thống, báo quản trị viên.',
      });
    }
    return resolver.labelFor(ownerType, ownerId);
  }

  /** Ném `400 OWNER_NOT_FOUND` nếu chủ thể không tồn tại. */
  async assertExists(ownerType: string, ownerId: string): Promise<void> {
    if ((await this.labelFor(ownerType, ownerId)) === null) {
      throw new BadRequestException({
        code: 'OWNER_NOT_FOUND',
        message: 'Hồ sơ được chọn không tồn tại (có thể vừa bị xóa). Tải lại rồi thử lại.',
      });
    }
  }
}

@Global()
@Module({ providers: [OwnerExistsRegistry], exports: [OwnerExistsRegistry] })
export class OwnerExistsModule {}
