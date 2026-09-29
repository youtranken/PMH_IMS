import { Controller, Get, Query } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { VaultOwnersService } from './vault-owners.service';
import { SecretDueService } from './secret-due.service';
import { NoStepUp } from '../auth/step-up.decorator';
import { SECRET_OWNER_TYPES, type SecretOwnerType } from './vault.service';

class DueQueryDto {
  @IsIn([...SECRET_OWNER_TYPES], { message: 'Loại hồ sơ không hợp lệ.' })
  ownerType!: SecretOwnerType;
}

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
@NoStepUp()
@Controller('api/v1/vault/owners')
export class VaultOwnersController {
  constructor(
    private readonly owners: VaultOwnersService,
    private readonly due: SecretDueService,
  ) {}

  @Roles('sa', 'admin')
  @Get()
  list() {
    return this.owners.list();
  }

  /**
   * Hạn đổi mật khẩu theo từng hồ sơ của MỘT loại (Q-15) — cột "Đổi lần cuối" ở danh sách tài
   * khoản dịch vụ. Chỉ id hồ sơ + mốc + số ngày còn/quá, không nhãn ngăn. Cùng quyền với bản
   * đồ két ở trên: Member không nhận.
   *
   * Màn danh sách tự ghép theo id thay vì module `service-accounts` gọi sang `vault`: `vault`
   * đã phụ thuộc `service-accounts` (gọi tên chủ thể), gọi ngược là vòng phụ thuộc (AD-2).
   */
  @Roles('sa', 'admin')
  @Get('due')
  dueByOwner(@Query() query: DueQueryDto) {
    return this.due.byOwner(query.ownerType);
  }
}
