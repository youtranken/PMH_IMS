import { Injectable } from '@nestjs/common';
import { VaultOwnersService, type VaultOwnerSummary } from './vault-owners.service';
import {
  VaultService,
  type SecretMeta,
  type SecretOwnerType,
} from './vault.service';

/**
 * AD-2 + AD-4: public api DUY NHẤT của module `vault`.
 *
 * Cố ý KHÔNG có hàm nào trả về plaintext. Trang thiết bị / phần mềm chỉ được biết "có mấy
 * secret, tên gì" — muốn mở phải đi qua endpoint riêng của vault, có TOTP step-up (4.2).
 * Không có đường xuất toàn bộ két ở bất kỳ quyền nào (FR-026): ở đây không tồn tại thứ
 * để mà lỡ gọi.
 */
@Injectable()
export class VaultApiService {
  constructor(
    private readonly vault: VaultService,
    private readonly owners: VaultOwnersService,
  ) {}

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
}
