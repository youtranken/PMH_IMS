import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { VaultOwnersService } from './vault-owners.service';

/**
 * `GET /api/v1/vault/owners` — danh sách CHỦ THỂ đang giữ secret.
 *
 * Đặt ở controller RIÊNG, không nhét vào `vault.controller.ts`: file kia là mặt tiền của
 * chính các ngăn két và đang bị `vault-surface.spec.ts` canh từng dòng (không `@Get()` trần,
 * không route xuất hàng loạt). Trộn một route có hình dạng khác vào đó là làm mờ đúng cái
 * ranh giới mà bài kiểm đang giữ.
 *
 * Ranh giới của route này, và `vault-surface.spec.ts` kiểm luôn: nó KHÔNG được trả về nhãn
 * secret, loại secret hay giá trị — chỉ chủ thể và số ngăn. Xem `VaultOwnersService`.
 *
 * Quyền SA + Admin. Member cố ý KHÔNG thấy: bản đồ "công ty giữ bí mật ở đâu" không phải
 * thứ mở cho mọi người, kể cả khi nó không nói trong đó có gì.
 */
@Controller('api/v1/vault/owners')
export class VaultOwnersController {
  constructor(private readonly owners: VaultOwnersService) {}

  @Roles('sa', 'admin')
  @Get()
  list() {
    return this.owners.list();
  }
}
