import { Injectable } from '@nestjs/common';
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
  constructor(private readonly vault: VaultService) {}

  /** Metadata thôi — nhãn, loại, ai cất. Không bao giờ có giá trị. */
  listFor(ownerType: SecretOwnerType, ownerId: string): Promise<SecretMeta[]> {
    return this.vault.listFor(ownerType, ownerId);
  }

  countFor(ownerType: SecretOwnerType, ownerId: string): Promise<number> {
    return this.vault.countFor(ownerType, ownerId);
  }
}
