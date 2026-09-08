import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  OwnerAccessRegistry,
  type OwnerAccessChecker,
} from '../../common/owner-access.registry';
import { BreakGlassService } from './break-glass.service';
import { VaultOwnersService, type VaultOwnerSummary } from './vault-owners.service';
import {
  SECRET_OWNER_TYPES,
  VaultService,
  type SecretMeta,
  type SecretOwnerType,
} from './vault.service';

/**
 * Bốn loại chủ thể mà MA TRẬN QUYỀN của két phủ. Xuất ra ngoài để `files` biết đường nào cần
 * hỏi quyền và đường nào không — xem `assertMemberCanSee` bên dưới.
 */
export { SECRET_OWNER_TYPES, type SecretOwnerType };

/**
 * AD-2 + AD-4: public api DUY NHẤT của module `vault`.
 *
 * Cố ý KHÔNG có hàm nào trả về plaintext. Trang thiết bị / phần mềm chỉ được biết "có mấy
 * secret, tên gì" — muốn mở phải đi qua endpoint riêng của vault, có TOTP step-up (4.2).
 * Không có đường xuất toàn bộ két ở bất kỳ quyền nào (FR-026): ở đây không tồn tại thứ
 * để mà lỡ gọi.
 */
@Injectable()
export class VaultApiService implements OnModuleInit, OwnerAccessChecker {
  constructor(
    private readonly vault: VaultService,
    private readonly owners: VaultOwnersService,
    private readonly breakGlass: BreakGlassService,
    private readonly ownerAccess: OwnerAccessRegistry,
  ) {}

  /**
   * Loại chủ thể mà `vault` nhận canh quyền ĐỌC ĐÍNH KÈM — chỉ `service_account` và `isp`.
   *
   * KHÔNG phải cả bốn loại của `SECRET_OWNER_TYPES`, và đây là chỗ bản đầu của tôi làm sai:
   * gác cả `device`/`software` thì mọi Member mất quyền xem MỌI giấy tờ thiết bị (ma trận là
   * opt-in, `resolveTier` mặc định `'denied'`, và Member mặc định không có dòng nào trong
   * `access_list`). Đã đo thật: `GET /files?ownerType=device` trả 403 cho Member. Hóa đơn và
   * biên bản bàn giao thiết bị là thứ cả team IT xem hằng ngày — đúng điều story 2.3 nói, và
   * điều đó vẫn đúng.
   *
   * Hai loại ở đây là hai loại được thêm vào `FILE_OWNER_TYPES` SAU khi ma trận ra đời, và là
   * hai loại mà đính kèm hay chép sẵn thông tin đăng nhập (biên bản bàn giao tài khoản dịch
   * vụ, ảnh chụp cấu hình router). Đó là lỗ hổng thật cần bịt, không phải cả bốn.
   *
   * Muốn siết thêm `device`/`software` về sau thì thêm vào đây — nhưng phải là một quyết định
   * có ý thức, kèm đường cho SA cấp quyền hàng loạt, không phải tác dụng phụ.
   */
  readonly ownerTypes = ['service_account', 'isp'] as const;

  /**
   * Nhận canh quyền đọc cho 4 loại đó, thay cho mọi module nền muốn hỏi (hiện là `files`).
   * Ghi vào sổ ở đây chứ không để `files` gọi ngược — xem `common/owner-access.registry.ts`.
   */
  onModuleInit(): void {
    this.ownerAccess.register(this);
  }

  /** `OwnerAccessChecker` — chữ ký rộng (string) vì sổ dùng chung cho mọi loại chủ thể. */
  assertCanSee(memberEmail: string, ownerType: string, ownerId: string): Promise<void> {
    return this.assertMemberCanSee(memberEmail, ownerType as SecretOwnerType, ownerId);
  }

  /** Metadata thôi — nhãn, loại, ai cất. Không bao giờ có giá trị. */
  listFor(ownerType: SecretOwnerType, ownerId: string): Promise<SecretMeta[]> {
    return this.vault.listFor(ownerType, ownerId);
  }

  countFor(ownerType: SecretOwnerType, ownerId: string): Promise<number> {
    return this.vault.countFor(ownerType, ownerId);
  }

  /**
   * Chủ thể đang giữ két + lần đổi gần nhất — CHÍNH XÁC cùng dữ liệu mà `GET /vault/owners`
   * đã trả cho SA/Admin từ 26/08, không hơn một trường nào.
   *
   * Vì sao được phép mở ra ngoài module (và vì sao `vault-surface.spec.ts` phải sửa theo):
   * `VaultOwnerSummary` cố ý không có `label`, không có `kind`, không có giá trị — bài kiểm
   * ghim từng tên trường của nó. Nên thứ rời khỏi vault ở đây là "hồ sơ nào có két, mấy ngăn,
   * đổi lần cuối bao giờ", không phải bản đồ bí mật.
   *
   * Bên gọi vẫn phải tự gác vai: bảng điều khiển chỉ dựng khối này cho SA/Admin, đúng như
   * `VaultOwnersController`. Hàm này không biết ai đang hỏi nên không tự gác được — và đó
   * chính là lý do phải nói rõ ở đây.
   */
  listOwners(): Promise<VaultOwnerSummary[]> {
    return this.owners.list();
  }

  /**
   * "Người này có được nhìn thấy chủ thể đó không" — ném `ACCESS_DENIED` nếu không.
   *
   * MỞ RA NGOÀI MODULE cho `files` (rà soát 07/09, C1). Két có ma trận quyền ba tầng và mặc
   * định là CẤM (`access-list.service.ts` trả `'denied'` khi không có luật nào áp), nhưng kho
   * file đính kèm thì không kiểm gì: một Member bị `denied` trên một tài khoản dịch vụ vẫn
   * `GET /files?ownerType=service_account&ownerId=…` để lấy danh sách id, rồi tải từng cái.
   * Đính kèm của tài khoản dịch vụ hay là biên bản bàn giao, ảnh chụp cấu hình router — loại
   * giấy tờ thường có thông tin đăng nhập chép ngay trên đó.
   *
   * Hàm này chỉ trả lời câu hỏi quyền; nó KHÔNG mở đường tới bất cứ giá trị bí mật nào, nên
   * bề mặt công khai của `vault` vẫn giữ nguyên tính chất mà `vault-surface.spec.ts` canh.
   *
   * Chỉ áp cho 4 loại chủ thể mà ma trận phủ (`SECRET_OWNER_TYPES`). `subnet`/`nat_rule` là
   * chủ thể của FILE nhưng không phải của KÉT — với chúng không tồn tại khái niệm "tầng quyền",
   * nên bên gọi phải tự quyết, xem chú thích ở `files.controller.ts`.
   */
  assertMemberCanSee(
    memberEmail: string,
    ownerType: SecretOwnerType,
    ownerId: string,
  ): Promise<void> {
    return this.breakGlass.assertCanSeeMetadata(memberEmail, ownerType, ownerId);
  }
}
